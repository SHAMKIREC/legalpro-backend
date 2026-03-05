require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

const PDFDocument = require('pdfkit')
const { Document, Packer, Paragraph, TextRun } = require("docx")

const app = express()
const prisma = new PrismaClient()

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
}))

app.use(express.json())

/* ==============================
LOGGER
============================== */

app.use((req,res,next)=>{
  console.log(`[${req.method}] ${req.path}`)
  next()
})

/* ==============================
HEALTH
============================== */

app.get("/api/health",(req,res)=>{
  res.json({status:"ok"})
})

/* ==============================
AUTH MIDDLEWARE
============================== */

function auth(req,res,next){

  const token = req.headers.authorization?.split(" ")[1]

  if(!token){
    return res.status(401).json({error:"No token"})
  }

  try{

    req.user = jwt.verify(token,process.env.JWT_SECRET)

    next()

  }catch(e){

    return res.status(403).json({error:"Invalid token"})

  }

}

/* ==============================
TELEGRAM LOGIN
============================== */

app.get("/api/auth/telegram-login", async (req,res)=>{

  try{

    const { id, username, first_name, last_name } = req.query

    if(!id){
      return res.status(400).send("Telegram login error")
    }

    let user = await prisma.user.findUnique({
      where:{ telegramId:String(id) }
    })

    if(!user){

      user = await prisma.user.create({
        data:{
          telegramId:String(id),
          username:username || "",
          firstName:first_name || "",
          lastName:last_name || "",
          generationCount:0,
          proStatus:false,
          lastLoginAt:new Date()
        }
      })

    }else{

      user = await prisma.user.update({
        where:{ telegramId:String(id) },
        data:{ lastLoginAt:new Date() }
      })

    }

    const token = jwt.sign(
      {
        userId:user.id,
        telegramId:user.telegramId
      },
      process.env.JWT_SECRET,
      {expiresIn:"7d"}
    )

    res.redirect(`https://shamkirec.github.io/legalpro-site/?token=${token}`)

  }catch(e){

    console.error(e)
    res.status(500).send("Auth error")

  }

})

/* ==============================
TOKEN VALIDATION
============================== */

app.get("/api/auth/validate",auth,async(req,res)=>{

  try{

    const user = await prisma.user.findUnique({
      where:{ id:req.user.userId }
    })

    if(!user){
      return res.status(404).json({error:"User not found"})
    }

    res.json({user})

  }catch(e){

    res.status(500).json({error:"Server error"})

  }

})

/* ==============================
DOCUMENT GENERATION
============================== */

app.post("/api/generate",auth,async(req,res)=>{

  try{

    const user = await prisma.user.findUnique({
      where:{ id:req.user.userId }
    })

    if(!user){
      return res.status(404).json({error:"User not found"})
    }

    if(!user.proStatus && user.generationCount >= 2){
      return res.status(403).json({error:"Free limit exceeded"})
    }

    if(!user.proStatus){

      await prisma.user.update({
        where:{id:user.id},
        data:{ generationCount:{increment:1} }
      })

    }

    const { claimData, format } = req.body

    const text = `
ДОСУДЕБНАЯ ПРЕТЕНЗИЯ

Ответчик:
${claimData?.employer?.name || ""}

Адрес:
${claimData?.employer?.address || ""}

Заявитель:
${claimData?.workers?.map(w=>w.name).join(", ") || ""}

Описание ситуации:
${claimData?.circumstances?.description || ""}

Требование:
Прошу погасить задолженность и устранить нарушение закона.
`

/* ==============================
PDF
============================== */

    if(format === "pdf"){

      const doc = new PDFDocument()

      res.setHeader("Content-Type","application/pdf")
      res.setHeader("Content-Disposition","attachment; filename=pretension.pdf")

      doc.pipe(res)

      doc.fontSize(16).text("ДОСУДЕБНАЯ ПРЕТЕНЗИЯ")
      doc.moveDown()

      doc.fontSize(12).text(text)

      doc.end()

      return

    }

/* ==============================
DOCX
============================== */

    if(format === "docx"){

      const doc = new Document({
        sections:[
          {
            properties:{},
            children:[
              new Paragraph({
                children:[
                  new TextRun({
                    text:"ДОСУДЕБНАЯ ПРЕТЕНЗИЯ",
                    bold:true,
                    size:32
                  })
                ]
              }),
              new Paragraph({
                children:[
                  new TextRun({
                    text:text,
                    size:24
                  })
                ]
              })
            ]
          }
        ]
      })

      const buffer = await Packer.toBuffer(doc)

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=pretension.docx"
      )

      res.send(buffer)

      return

    }

    res.status(400).json({error:"Invalid format"})

  }catch(e){

    console.error(e)

    res.status(500).json({
      error:"Generation error"
    })

  }

})

/* ==============================
404
============================== */

app.use((req,res)=>{
  res.status(404).json({error:"Route not found"})
})

/* ==============================
START SERVER
============================== */

const PORT = process.env.PORT || 8080

async function start(){

  await prisma.$connect()

  app.listen(PORT,()=>{
    console.log("✓ Server running on",PORT)
  })

}

start()
