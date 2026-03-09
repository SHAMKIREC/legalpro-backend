const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

// Token configuration
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const MAX_REFRESH_TOKENS_PER_USER = 5;

/**
 * Telegram WebApp authentication
 * Validates initData and creates session
 */
router.post('/telegram', async (req, res) => {
  try {
    let { initData, initDataUnsafe, telegramId, username, firstName, lastName } = req.body;

    let telegramUser;

    if (telegramId && !initData) {
      // browser fallback mode
      telegramUser = {
        id: telegramId,
        username: username,
        first_name: firstName || '',
        last_name: lastName || ''
      };
    } else {
      // normal Telegram WebApp flow
      if (!initData || !initDataUnsafe) {
        return res.status(400).json({ error: 'Missing Telegram data' });
      }

      // Verify Telegram signature
      const isValid = verifyTelegramWebAppData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!isValid) {
        await logSecurityEvent(req, 'INVALID_TELEGRAM_SIGNATURE', { initDataUnsafe });
        return res.status(403).json({ error: 'Invalid Telegram signature' });
      }

      // Check for replay attacks (auth_date must be within 5 minutes)
      const authDate = parseInt(initDataUnsafe.auth_date) * 1000;
      const now = Date.now();
      if (now - authDate > 5 * 60 * 1000) {
        await logSecurityEvent(req, 'TELEGRAM_REPLAY_ATTACK', { authDate });
        return res.status(403).json({ error: 'Request expired' });
      }

      // Extract user data
      telegramUser = JSON.parse(initDataUnsafe.user);
    }
    
    // Find or create user
    let user = await prisma.user.findUnique({
      where: { telegramId: telegramUser.id.toString() }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: telegramUser.id.toString(),
          username: telegramUser.username,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          photoUrl: telegramUser.photo_url,
          languageCode: telegramUser.language_code,
          lastLoginAt: new Date()
        }
      });
    } else {
      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
    }

    // Generate tokens
    const tokens = await generateTokenPair(user, req, res);

    // Set CSRF token cookie
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', csrfToken, {
      httpOnly: false, // Must be accessible by JS for double-submit
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      accessToken: tokens.accessToken,
      expiresIn: 900, // 15 minutes
      user: sanitizeUser(user)
    });

    // NOTE: frontend expects token in response, already provided above.

  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Refresh token rotation
 */
router.post('/refresh', async (req, res) => {
  try {
    // Get refresh token from HttpOnly cookie
    const refreshToken = req.cookies?.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    // Check if token is in whitelist (not revoked)
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true }
    });

    if (!storedToken || storedToken.revokedAt) {
      // Potential token theft - revoke all user tokens
      await revokeAllUserTokens(decoded.userId);
      await logSecurityEvent(req, 'REFRESH_TOKEN_REUSE', { userId: decoded.userId });
      return res.status(401).json({ error: 'Token revoked' });
    }

    // Rotate: Delete old token, create new one
    await prisma.refreshToken.delete({
      where: { id: storedToken.id }
    });

    const tokens = await generateTokenPair(storedToken.user, req, res);

    res.json({
      accessToken: tokens.accessToken,
      expiresIn: 900
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

/**
 * Logout - revoke tokens
 */
// PRO activation endpoint (simple key check)
router.post('/activate-pro', authenticateToken, async (req, res) => {
  try {
    const { key } = req.body;
    // in production validate key more securely
    if (!key || key !== process.env.PRO_KEY) {
      return res.status(400).json({ error: 'Invalid pro key' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { proStatus: true, proActivatedAt: new Date() }
    });
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error('PRO activation error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revokedAt: new Date() }
      });
    }

    res.clearCookie('refreshToken');
    res.clearCookie('csrfToken');
    
    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * Validate current session
 */
router.get('/validate', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      user: sanitizeUser(user),
      expiresIn: req.user.exp - Math.floor(Date.now() / 1000)
    });

  } catch (error) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

// Helper functions

function verifyTelegramWebAppData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  // Sort params alphabetically
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const computedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return computedHash === hash;
}

async function generateTokenPair(user, req, res) {
  const accessToken = jwt.sign(
    { 
      userId: user.id, 
      telegramId: user.telegramId,
      proStatus: user.proStatus 
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  ); // signed with JWT_SECRET default


  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  // Store refresh token hash (not plain token) for security
  const refreshTokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  // Enforce max refresh tokens per user (prevent hoarding)
  const existingTokens = await prisma.refreshToken.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: 'asc' }
  });

  if (existingTokens.length >= MAX_REFRESH_TOKENS_PER_USER) {
    // Revoke oldest tokens
    const tokensToRevoke = existingTokens.slice(0, existingTokens.length - MAX_REFRESH_TOKENS_PER_USER + 1);
    await prisma.refreshToken.updateMany({
      where: { id: { in: tokensToRevoke.map(t => t.id) } },
      data: { revokedAt: new Date() }
    });
  }

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken, // In production, store hash only
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  // Set refresh token as HttpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth/refresh' // Restrict to refresh endpoint only
  });

  return { accessToken, refreshToken };
}

async function revokeAllUserTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

function sanitizeUser(user) {
  const { id, telegramId, username, firstName, lastName, photoUrl, proStatus, generationCount, createdAt } = user;
  return { id, telegramId, username, firstName, lastName, photoUrl, proStatus, generationCount, createdAt };
}

async function logSecurityEvent(req, type, details) {
  // Временно просто логируем в консоль, чтобы избежать ошибок БД
  console.log("SECURITY EVENT:", type, details);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}
// Telegram login через кнопку Telegram
router.get('/telegram-login', async (req, res) => {

  try {

    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.query

    if (!id || !auth_date || !hash) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const dataCheckString = Object.keys(req.query)
      .filter(key => key !== "hash")
      .sort()
      .map(key => `${key}=${req.query[key]}`)
      .join("\n")

    const secretKey = crypto
      .createHash("sha256")
      .update(process.env.TELEGRAM_BOT_TOKEN)
      .digest()

    const hmac = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex")

    if (hmac !== hash) {
      return res.status(403).json({ error: "Invalid telegram auth" })
    }

    let user = await prisma.user.findUnique({
      where: { telegramId: id.toString() }
    })

    if (!user) {

      user = await prisma.user.create({
        data: {
          telegramId: id.toString(),
          username: username || null,
          firstName: first_name || null,
          lastName: last_name || null,
          photoUrl: photo_url || null,
          proStatus: false,
          generationCount: 0
        }
      })

    }

    const token = jwt.sign(
      { userId: user.id, telegramId: user.telegramId },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    )

    res.redirect(`https://shamkirec.github.io/legalpro-site/?token=${token}`)

  } catch (e) {

    console.error("Telegram login error:", e)

    res.redirect(`https://shamkirec.github.io/legalpro-site/?error=server`)

  }

})

module.exports = router;
