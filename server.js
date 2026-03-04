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

app.use(cors({
  origin: [
    "https://shamkirec.github.io",
    "https://shamkirec.github.io/legalpro-site",
    "http://localhost:3000"
  ],
  methods: ["GET","POST","PUT","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());

/* ==============================
LOGGER
============================== */

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path}`);
  next();
});

/* ==============================
HEALTH CHECK
============================== */

app.get('/api/health', (req, res) => {
  res.json({ status: "ok" });
});

/* ==============================
AUTH MIDDLEWARE
============================== */

function auth(req, res, next) {

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token" });
  }

  try {

    req.user = jwt.verify(token, process.env.JWT_SECRET);

    next();

  } catch {

    return res.status(403).json({ error: "Invalid token" });

  }

}

/* ==============================
TELEGRAM DATA VALIDATION
============================== */

function validateTelegramData(initData) {

  if (!process.env.TELEGRAM_BOT_TOKEN) return false;

  const urlParams = new URLSearchParams(initData);

  const hash = urlParams.get("hash");

  urlParams.delete("hash");

  const dataCheckString = Array.from(urlParams.entries())
    .sort()
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return calculatedHash === hash;

}

/* ==============================
TELEGRAM LOGIN
============================== */
app.post("/api/auth/telegram", async (req, res) => {

  try {

    const {
      telegramId,
      username,
      firstName,
      lastName
    } = req.body;

    if (!telegramId) {
      return res.status(400).json({
        error: "telegramId required"
      });
    }

    let user = await prisma.user.findUnique({
      where: {
        telegramId: String(telegramId)
      }
    });

    if (!user) {

      user = await prisma.user.create({
        data: {
          telegramId: String(telegramId),
          username: username || "",
          firstName: firstName || "",
          lastName: lastName || "",
          generationCount: 0,
          lastLoginAt: new Date()
        }
      });

    } else {

      user = await prisma.user.update({
        where: {
          telegramId: String(telegramId)
        },
        data: {
          lastLoginAt: new Date()
        }
      });

    }

    const token = jwt.sign(
      {
        userId: user.id,
        telegramId: user.telegramId
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      user,
      token
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: "Server error"
    });

  }

});

/* ==============================
TOKEN VALIDATION
============================== */

app.get("/api/auth/validate", auth, async (req, res) => {

  try {

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.userId
      }
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json({
      user
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: "Server error"
    });

  }

});

/* ==============================
GENERATE DOCUMENT
============================== */

app.post("/api/generate", auth, async (req, res) => {

  try {

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.userId
      }
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    if ((user.generationCount || 0) >= 2) {
      return res.status(403).json({
        error: "Free limit exceeded"
      });
    }

    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        generationCount: {
          increment: 1
        }
      }
    });

    res.set("Content-Type","text/plain; charset=utf-8");

    res.send("Документ успешно создан");

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: "Server error"
    });

  }

});

/* ==============================
START SERVER
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

      exec("npx prisma db push", (err, stdout, stderr) => {

        console.log(stdout);

        console.log(stderr);

        if (err) reject(err);

        else resolve();

      });

    });

  }

  await prisma.$connect();

  app.listen(PORT, () => {

    console.log(`✓ Server running on port ${PORT}`);

  });

}

start();
