require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');

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
   ROOT
============================== */

app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>LegalPro</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body style="background:#0f172a;color:white;text-align:center;padding:40px;font-family:Arial">

<h1>LegalPro</h1>
<p id="status">Авторизация...</p>
<button onclick="generateDoc()" style="padding:15px 25px;border-radius:10px;border:none;background:#22c55e;color:black;font-size:18px">
Сгенерировать документ
</button>

<script>
function setStatus(t){document.getElementById('status').innerText=t;}

async function login(){
 try{
  if(!window.Telegram||!window.Telegram.WebApp){
   setStatus("Открыто вне Telegram");
   return;
  }
  const tg=window.Telegram.WebApp;
  tg.expand();
  if(!tg.initData){setStatus("Нет initData");return;}

  const r=await fetch('/api/auth/telegram',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({initData:tg.initData})
  });

  const d=await r.json();

  if(d.token){
   localStorage.setItem('token',d.token);
   setStatus("Вы авторизованы");
  }else{
   setStatus("Ошибка авторизации");
  }
 }catch(e){
  setStatus("Ошибка соединения");
 }
}

async function generateDoc(){
 const token=localStorage.getItem('token');
 if(!token){alert("Нет токена");return;}

 const r=await fetch('/api/generate',{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   'Authorization':'Bearer '+token
  }
 });

 if(r.ok){
  const t=await r.text();
  alert(t);
 }else{
  const e=await r.json();
  alert(e.error||"Ошибка");
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
   TELEGRAM VALIDATION
============================== */

function validateTelegramData(initData) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;

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
    if (!initData) return res.status(400).json({ error: 'No initData' });

    if (!validateTelegramData(initData))
      return res.status(403).json({ error: 'Invalid Telegram signature' });

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
    res.status(500).json({ error: 'Server error' });
  }
});

/* ==============================
   GENERATE
============================== */

app.post('/api/generate', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    if ((user.generationCount || 0) >= 2)
      return res.status(403).json({ error: 'Free limit exceeded' });

    await prisma.user.update({
      where: { id: user.id },
      data: { generationCount: { increment: 1 } }
    });

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send("Документ создан успешно.");

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ==============================
   AUTO DB INIT + START
============================== */

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    console.log("Checking database...");

    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;

  } catch (e) {
    console.log("Database not ready. Running prisma db push...");
    await new Promise((resolve, reject) => {
      exec('npx prisma db push', (err, stdout, stderr) => {
        console.log(stdout);
        console.log(stderr);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  await prisma.$connect();

  app.listen(PORT, () =>
    console.log(`✓ Server running on port ${PORT}`)
  );
}

start();
