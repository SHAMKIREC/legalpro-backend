/**
 * LegalPro Backend - Minimal Test Version
 */
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// HEALTH - FIRST before other middleware
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Then helmet/cors
app.use(helmet());
app.use(cors({ origin: 'http://localhost:3001', credentials: true }));

// simple auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const token = authHeader.substring(7);
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// AUTH: Telegram
app.post('/api/auth/telegram', async (req, res) => {
  try {
    let { telegramId, username, firstName, lastName } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: 'Missing telegramId' });
    }

    let user = await prisma.user.findUnique({ where: { telegramId } });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          username: username || '',
          firstName: firstName || '',
          lastName: lastName || ''
        }
      });
    } else {
      user = await prisma.user.update({
        where: { telegramId },
        data: { username, firstName, lastName, lastLoginAt: new Date() }
      });
    }

    const token = jwt.sign(
      { userId: user.id, telegramId: user.telegramId, proStatus: user.proStatus },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ user, token });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AUTH: Validate
app.get('/api/auth/validate', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AUTH: Activate PRO
app.post('/api/auth/activate-pro', authMiddleware, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || key !== process.env.PRO_KEY) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { proStatus: true, proActivatedAt: new Date() }
    });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GENERATE: Document
app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const { claimData, format } = req.body;

    // Check limits
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user.proStatus && user.generationCount >= 2) {
      return res.status(403).json({ error: 'Free limit exceeded', redirectToPricing: true });
    }

    // Increment count
    await prisma.user.update({
      where: { id: user.id },
      data: { generationCount: { increment: 1 } }
    });

    // Build claim
    const requester = (claimData?.workers || []).map(w => w.name).join(', ') || 'Заявитель';
    const respondent = claimData?.employer?.name || 'Ответчик';
    const bodyText = claimData?.description || claimData?.circumstances?.description || '';

    const claim = `Досудебная претензия\n\nОт: ${requester}\nКому: ${respondent}\n\nСуть нарушения:\n${bodyText}\n\nДата: ${new Date().toLocaleDateString()}\nПодпись: ___________`;

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="pretension_${Date.now()}.txt"`
    });
    res.send(claim);
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// START
async function boot() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`🚀 LegalPro running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
}

boot();
