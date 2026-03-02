require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();

/* ==============================
   CONFIG
============================== */

app.use(cors());
app.use(express.json());

/* ==============================
   LOGGER
============================== */

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path}`);
  next();
});

/* ==============================
   AUTH MIDDLEWARE
============================== */

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/* ==============================
   TELEGRAM SIGNATURE VALIDATION
============================== */

function validateTelegramData(initData) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort()
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return calculatedHash === hash;
}

/* ==============================
   HEALTH CHECK
============================== */

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* ==============================
   TELEGRAM LOGIN (REAL)
============================== */

app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body;

    if (!initData) {
      return res.status(400).json({ error: 'No initData' });
    }

    const isValid = validateTelegramData(initData);

    if (!isValid) {
      return res.status(403).json({ error: 'Invalid Telegram signature' });
    }

    const params = new URLSearchParams(initData);
    const tgUser = JSON.parse(params.get('user'));

    let user = await prisma.user.findUnique({
      where: { telegramId: String(tgUser.id) }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: String(tgUser.id),
          username: tgUser.username || '',
          firstName: tgUser.first_name || '',
          lastName: tgUser.last_name || '',
          lastLoginAt: new Date()
        }
      });
    } else {
      user = await prisma.user.update({
        where: { telegramId: String(tgUser.id) },
        data: { lastLoginAt: new Date() }
      });
    }

    const token = jwt.sign(
      { userId: user.id, telegramId: user.telegramId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ user, token });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ==============================
   VALIDATE TOKEN
============================== */

app.get('/api/auth/validate', auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId }
  });
  res.json({ user });
});

/* ==============================
   ACTIVATE PRO
============================== */

app.post('/api/pro/activate', auth, async (req, res) => {
  try {
    const proUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        proStatus: true,
        proActivatedAt: new Date(),
        proUntil
      }
    });

    const token = jwt.sign(
      { userId: user.id, telegramId: user.telegramId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, user, token });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ==============================
   GENERATE DOCUMENT
============================== */

app.post('/api/generate', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });

    const now = new Date();
    const isProActive = user.proUntil && user.proUntil > now;

    if (!isProActive && user.generationCount >= 2) {
      return res.status(403).json({
        error: 'Free limit exceeded',
        redirectToPricing: true
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { generationCount: { increment: 1 } }
    });

    const documentText = `
ДОСУДЕБНАЯ ПРЕТЕНЗИЯ

Дата: ${now.toLocaleDateString()}

Текст претензии формируется автоматически...

LegalPro
`;

    res.set(
      'Content-Disposition',
      `attachment; filename="pretension_${Date.now()}.txt"`
    );

    res.send(documentText);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ==============================
   404
============================== */

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* ==============================
   START SERVER
============================== */

const PORT = process.env.PORT || 5555;

prisma.$connect().then(() => {
  app.listen(PORT, () =>
    console.log(`✓ Server on port ${PORT}`)
  );
}).catch(e => {
  console.error('Database error:', e.message);
  process.exit(1);
});