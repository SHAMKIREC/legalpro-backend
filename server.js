require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

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
LOGIN / REGISTRATION
============================== */

app.post("/api/auth/telegram", async (req,res)=>{

  try{

    console.log("AUTH BODY:",req.body)

    const {
      telegramId,
      username,
      firstName,
      lastName
    } = req.body

    if(!telegramId){

      return res.status(400).json({
        error:"telegramId required"
      })

    }

    let user = await prisma.user.findUnique({
      where:{
        telegramId:String(telegramId)
      }
    })

    if(!user){

      user = await prisma.user.create({
        data:{
          telegramId:String(telegramId),
          username:username || "",
          firstName:firstName || "",
          lastName:lastName || "",
          generationCount:0,
          proStatus:false,
          lastLoginAt:new Date()
        }
      })

    }else{

      user = await prisma.user.update({
        where:{
          telegramId:String(telegramId)
        },
        data:{
          lastLoginAt:new Date()
        }
      })

    }

    const token = jwt.sign(
      {
        userId:user.id,
        telegramId:user.telegramId
      },
      process.env.JWT_SECRET,
      {
        expiresIn:"7d"
      }
    )

    res.json({
      success:true,
      user,
      token
    })

  }catch(e){

    console.error("AUTH ERROR:",e)

    res.status(500).json({
      error:"Server error"
    })

  }

})

/* ==============================
TOKEN VALIDATION
============================== */

app.get("/api/auth/validate",auth,async(req,res)=>{

  try{

    const user = await prisma.user.findUnique({
      where:{
        id:req.user.userId
      }
    })

    if(!user){
      return res.status(404).json({
        error:"User not found"
      })
    }

    res.json({user})

  }catch(e){

    console.error(e)

    res.status(500).json({
      error:"Server error"
    })

  }

})

/* ==============================
DOCUMENT GENERATION
============================== */

app.post("/api/generate",auth,async(req,res)=>{

  try{

    const user = await prisma.user.findUnique({
      where:{
        id:req.user.userId
      }
    })

    if(!user){
      return res.status(404).json({
        error:"User not found"
      })
    }

    /* FREE LIMIT */

    if(!user.proStatus){

      if((user.generationCount || 0) >= 2){

        return res.status(403).json({
          error:"Free limit exceeded"
        })

      }

      await prisma.user.update({
        where:{
          id:user.id
        },
        data:{
          generationCount:{
            increment:1
          }
        }
      })

    }

    res.json({
      success:true,
      message:"Документ успешно создан"
    })

  }catch(e){

    console.error(e)

    res.status(500).json({
      error:"Server error"
    })

  }

})

/* ==============================
404
============================== */

app.use((req,res)=>{
  res.status(404).json({
    error:"Route not found"
  })
})

/* ==============================
START SERVER
============================== */

const PORT = process.env.PORT || 8080

async function start(){

  try{

    console.log("Connecting DB...")

    await prisma.$connect()

    console.log("DB connected")

  }catch(e){

    console.error("DB error",e)

  }

  app.listen(PORT,()=>{
    console.log("✓ Server running on port",PORT)
  })

}

start()
