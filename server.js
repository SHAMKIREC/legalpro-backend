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
   ROOT = TELEGRAM WEBAPP PAGE
============================== */

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>LegalPro</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  body {
    font-family: Arial, sans-serif;
    background: #0f172a;
    color: white;
    text-align: center;
    padding: 40px;
  }
  button {
    margin-top: 20px;
    padding: 14px 24px;
    font-size: 18px;
    border-radius: 12px;
    border: none;
    background: #22c55e;
    color: black;
    cursor: pointer;
  }
</style>
</head>
<body>

<h1>LegalPro</h1>
<p id="status">Авторизация...</p>
<button onclick="generateDoc()">Сгенерировать документ</button>

<script>
  const tg = window.Telegram.WebApp;
  tg.expand();

  async function login() {
    try {
      const response = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData })
      });

      const data = await response.json();

      if (data.token) {
        localStorage.setItem('token', data.token);
        document.getElementById('status').innerText = "Вы авторизованы";
      } else {
        document.getElementById('status').innerText = "Ошибка авторизации";
      }
    } catch (e) {
      document.getElementById('status').innerText = "Ошибка соединения";
    }
  }

  async function generateDoc() {
    const token = localStorage.getItem('token');

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    });

    if (response.ok) {
      const text = await response.text();
      alert(text);
    } else {
      const err = await response.json();
      alert(err.error);
    }
  }

  login();
</script>

</body>
</html>
  `);
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
  } catch {
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
   HEALTH
============================== */

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* ==============================
   TELEGRAM LOGIN
============================== */

app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ error: 'No initData' });
    }

    if (!validateTelegramData(initData)) {
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
          lastLoginAt: new Date(),
          generationCount: 0
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
   GENERATE DOCUMENT
============================== */

app.post('/api/generate', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });

    const now = new Date();

    if (user.generationCount >= 2) {
      return res.status(403).json({
        error: 'Free limit exceeded'
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

    res.send(documentText);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ==============================
   404
============================== */

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 5555;

prisma.$connect()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`✓ Server running on port ${PORT}`)
    );
  })
  .catch(e => {
    console.error('Database error:', e.message);
    process.exit(1);
  });
