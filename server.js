require('dotenv').config()

const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const path = require('path')

const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

const PDFDocument = require('pdfkit')
const { Document, Packer, Paragraph, TextRun } = require("docx")

/* ============================= */

if(!process.env.JWT_SECRET){
 console.error("JWT_SECRET not defined")
 process.exit(1)
}

if(!process.env.BOT_TOKEN){
 console.error("BOT_TOKEN not defined")
 process.exit(1)
}

/* ============================= */

const app = express()
const prisma = new PrismaClient()

/* ==============================
CONFIG
============================== */

app.use(cors({
 origin:[
  "https://shamkirec.github.io",
  "https://shamkirec.github.io/legalpro-site",
  "http://localhost:3000"
 ],
 methods:["GET","POST"],
 allowedHeaders:["Content-Type","Authorization"]
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
VERIFY TELEGRAM DATA
============================== */

function verifyTelegramAuth(data){

 const checkHash = data.hash
 delete data.hash

 const sorted = Object.keys(data)
  .sort()
  .map(k => `${k}=${data[k]}`)
  .join('\n')

 const secret = crypto
  .createHash('sha256')
  .update(process.env.BOT_TOKEN)
  .digest()

 const hmac = crypto
  .createHmac('sha256',secret)
  .update(sorted)
  .digest('hex')

 return hmac === checkHash

}

/* ==============================
CHECK TELEGRAM CHANNEL SUB
============================== */

async function checkSubscription(userId){

 try{

  const url =
   `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=@LegalProSupport&user_id=${userId}`

  const r = await fetch(url)
  const data = await r.json()

  const status = data.result?.status

  return (
   status === "member" ||
   status === "administrator" ||
   status === "creator"
  )

 }catch(e){

  console.error("Subscription check error",e)
  return false

 }

}

/* ==============================
TELEGRAM LOGIN
============================== */

app.get("/api/auth/telegram-login", async (req,res)=>{

 try{

  const data = {...req.query}

  if(!verifyTelegramAuth({...data})){
   return res.status(403).send("Invalid Telegram auth")
  }

  const telegramId = data.id

  const username = data.username || ""
  const firstName = data.first_name || ""
  const lastName = data.last_name || ""

  /* check channel subscription */

  const subscribed = await checkSubscription(telegramId)

  if(!subscribed){

   return res.redirect(
    "https://shamkirec.github.io/legalpro-site/?error=subscribe"
   )

  }

  let user = await prisma.user.findUnique({
   where:{telegramId:String(telegramId)}
  })

  if(!user){

   user = await prisma.user.create({
    data:{
     telegramId:String(telegramId),
     username:username,
     firstName:firstName,
     lastName:lastName,
     generationCount:0,
     proStatus:false,
     lastLoginAt:new Date()
    }
   })

  }else{

   user = await prisma.user.update({
    where:{telegramId:String(telegramId)},
    data:{lastLoginAt:new Date()}
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

  return res.redirect(
   `https://shamkirec.github.io/legalpro-site/?token=${token}`
  )

 }catch(e){

  console.error("Telegram login error",e)

  return res.redirect(
   "https://shamkirec.github.io/legalpro-site/?error=server"
  )

 }

})

/* ==============================
TOKEN VALIDATION
============================== */

app.get("/api/auth/validate",auth,async(req,res)=>{

 try{

  const user = await prisma.user.findUnique({
   where:{id:req.user.userId}
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
   where:{id:req.user.userId}
  })

  if(!user){
   return res.status(404).json({error:"User not found"})
  }

  if(!user.proStatus && user.generationCount >= 2){
   return res.status(403).json({error:"Free limit exceeded"})
  }

  const {claimData,format} = req.body

  if(format === "docx" && !user.proStatus){
   return res.status(403).json({error:"PRO required"})
  }

  if(!user.proStatus){

   await prisma.user.update({
    where:{id:user.id},
    data:{generationCount:{increment:1}}
   })

  }

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

   const fontPath =
    path.join(__dirname,"fonts","DejaVuSans.ttf")

   doc.registerFont("main",fontPath)
   doc.font("main")

   res.setHeader(
    "Content-Type",
    "application/pdf"
   )

   res.setHeader(
    "Content-Disposition",
    "attachment; filename=pretension.pdf"
   )

   doc.pipe(res)

   doc.fontSize(18).text("ДОСУДЕБНАЯ ПРЕТЕНЗИЯ")

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
     children:[
      new Paragraph({
       children:[
        new TextRun({
         text:"ДОСУДЕБНАЯ ПРЕТЕНЗИЯ",
         bold:true,
         size:36
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

  res.status(500).json({error:"Generation error"})

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

 try{

  await prisma.$connect()

  console.log("DB connected")

 }catch(e){

  console.error("DB error",e)

 }

 app.listen(PORT,()=>{
  console.log("✓ Server running on",PORT)
 })

}

start()
