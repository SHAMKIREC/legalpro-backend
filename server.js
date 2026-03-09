require('dotenv').config()

const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')

const express = require('express')
const rateLimit = require('express-rate-limit')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const jwt = require('jsonwebtoken')

const PDFDocument = require('pdfkit')
const { Document, Packer, Paragraph, TextRun } = require("docx")

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const app = express()
const generateLimiter = rateLimit({
windowMs: 60 * 1000,
max: 10,
message: { error: "Too many document generations" }
})

const companySearchLimiter = rateLimit({
windowMs: 60 * 1000,
max: 20,
message: { error: "Too many requests" }
})

const companyCache = new Map()

/* ============================= */

if (!process.env.JWT_SECRET) {
console.error("JWT_SECRET not defined")
process.exit(1)
}

if (!process.env.TELEGRAM_BOT_TOKEN) {
console.error("TELEGRAM_BOT_TOKEN not defined")
process.exit(1)
}

if (!process.env.DADATA_KEY) {
console.warn("DADATA_KEY not defined")
}

/* ============================= */

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
app.use(cookieParser())

/* =============================
AUTH
============================= */

function auth(req,res,next){

const token = req.headers.authorization?.split(" ")[1]

if(!token) return res.status(401).json({error:"No token"})

try{

req.user = jwt.verify(token,process.env.JWT_SECRET)

next()

}catch(e){

return res.status(403).json({error:"Invalid token"})

}

}

/* =============================
EVIDENCE MAP
============================= */

const evidenceMap = {

"Переписка в мессенджерах":
"перепиской в мессенджерах с руководством",

"Банковские переводы":
"банковскими переводами денежных средств",

"Журнал учета рабочего времени":
"журналом учета рабочего времени",

"Пропускная система":
"пропускной системой или картой доступа",

"Свидетельские показания":
"свидетельскими показаниями",

"Трудовой договор":
"трудовым или гражданско-правовым договором"

}

function generateEvidenceText(evidence){

if(!evidence || evidence.length===0) return ""

let text = "Факт выполнения работ подтверждается:\n\n"

evidence.forEach(e=>{
text += `— ${evidenceMap[e] || e};\n`
})

return text

}

/* =============================
LAW BLOCK
============================= */

function generateLawBlock(category){

if(category==="salary"){

return `
Согласно ст.136 ТК РФ заработная плата должна выплачиваться своевременно.

Согласно ст.236 ТК РФ при задержке выплаты работодатель обязан выплатить компенсацию.
`
}

if(category==="unofficial"){

return `
Согласно ст.16 ТК РФ трудовые отношения возникают при фактическом допуске к работе.

Согласно ст.67 ТК РФ работодатель обязан оформить трудовой договор.
`
}

if(category==="dismissal"){

return `
Согласно ст.140 ТК РФ расчет при увольнении производится в день увольнения.
`
}

if(category==="zpp_product"){

return `
Согласно ст.18 Закона РФ "О защите прав потребителей" покупатель вправе требовать возврата денежных средств за товар ненадлежащего качества.
`
}

if(category==="zpp_service"){

return `
Согласно ст.29 Закона РФ "О защите прав потребителей" потребитель вправе требовать возврата средств за некачественную услугу.
`
}

if(category==="infoproduct"){

return `
Согласно ст.29 Закона РФ "О защите прав потребителей" и ст.779 ГК РФ исполнитель обязан оказать услугу надлежащего качества.
`
}

if(category==="loan"){

return `
Согласно ст.807 ГК РФ заемщик обязан вернуть сумму займа.
`
}

return `
Согласно ст.309 ГК РФ обязательства должны исполняться надлежащим образом.
`

}

/* =============================
VIOLATIONS BLOCK
============================= */

function generateViolationBlock(category){

if(category==="salary"){
return `
НАРУШЕНИЯ

1. Нарушение сроков выплаты заработной платы.
2. Нарушение требований ст.136 ТК РФ.
`
}

if(category==="unofficial"){
return `
НАРУШЕНИЯ

1. Фактический допуск к работе без оформления трудового договора.
2. Нарушение ст.16 и ст.67 ТК РФ.
`
}

if(category==="dismissal"){
return `
НАРУШЕНИЯ

1. Не произведён расчет при увольнении.
2. Нарушена ст.140 ТК РФ.
`
}

if(category==="zpp_product"){
return `
НАРУШЕНИЯ

1. Реализация товара ненадлежащего качества.
2. Нарушение ст.18 Закона РФ "О защите прав потребителей".
`
}

if(category==="zpp_service"){
return `
НАРУШЕНИЯ

1. Услуга оказана ненадлежащего качества.
2. Нарушение ст.29 Закона РФ "О защите прав потребителей".
`
}

if(category==="infoproduct"){
return `
НАРУШЕНИЯ

1. Образовательная услуга оказана ненадлежащего качества.
2. Нарушение ст.4 и ст.29 Закона РФ "О защите прав потребителей".
`
}

if(category==="loan"){
return `
НАРУШЕНИЯ

1. Заёмщик не вернул денежные средства.
2. Нарушение обязательств по договору займа.
`
}

return `
НАРУШЕНИЯ

1. Ненадлежащее исполнение обязательств.
`
}

/* =============================
CONSEQUENCES BLOCK
============================= */

function generateConsequences(data){

const amount = data.circumstances?.debtAmount || ""

return `
ПОСЛЕДСТВИЯ НАРУШЕНИЙ

В результате действий ответчика заявителю причинён материальный ущерб.

Размер ущерба: ${amount} руб.

Также действия ответчика причинили моральный вред.
`
}

/* =============================
DEMANDS BLOCK
============================= */

function generateDemandBlock(category){

if(category==="salary"){
return `
ТРЕБОВАНИЯ

1. Выплатить задолженность по заработной плате.
2. Выплатить компенсацию за задержку согласно ст.236 ТК РФ.
`
}

if(category==="zpp_product"){
return `
ТРЕБОВАНИЯ

1. Вернуть стоимость товара.
2. Компенсировать причинённые убытки.
`
}

if(category==="zpp_service"){
return `
ТРЕБОВАНИЯ

1. Вернуть денежные средства за услугу.
`
}

if(category==="infoproduct"){
return `
ТРЕБОВАНИЯ

1. Вернуть денежные средства за обучение.
2. Компенсировать причинённый моральный вред.
`
}

if(category==="loan"){
return `
ТРЕБОВАНИЯ

1. Вернуть сумму долга.
`
}

return `
ТРЕБОВАНИЯ

1. Исполнить обязательства по договору.
`
}

/* =============================
CONTROL AUTHORITIES
============================= */

function generateAuthorityBlock(category){

if(category==="salary" || category==="unofficial" || category==="dismissal"){
return `
В СЛУЧАЕ ОТКАЗА

В случае отказа выполнить указанные требования
я буду вынужден обратиться:

• в Государственную инспекцию труда
• в прокуратуру
• в суд
`
}

if(category==="zpp_product" || category==="zpp_service" || category==="infoproduct"){
return `
В СЛУЧАЕ ОТКАЗА

В случае отказа выполнить требования
я буду вынужден обратиться:

• в Роспотребнадзор
• в суд
`
}

if(category==="loan"){
return `
В СЛУЧАЕ ОТКАЗА

В случае отказа вернуть денежные средства
я буду вынужден обратиться в суд
с требованием о взыскании долга.
`
}

return `
В СЛУЧАЕ ОТКАЗА

В случае отказа я буду вынужден обратиться в суд.
`
}

/* =============================
TEXT GENERATOR
============================= */

function generateClaimText(data){

const employer=data.employer||{}
const workers=data.workers||[]
const circumstances=data.circumstances||{}

let claimants=""

workers.forEach(w=>{

claimants+=`
${w.name}
Адрес: ${w.address}
Телефон: ${w.phone}
Email: ${w.email}

`

})

const evidence = generateEvidenceText(data.evidence)

const law = generateLawBlock(data.type)

const violations = generateViolationBlock(data.type)

const consequences = generateConsequences(data)

const demands = generateDemandBlock(data.type)

const authorities = generateAuthorityBlock(data.type)

return{

employer,
claimants,
circumstances,
law,
evidence,
violations,
consequences,
demands,
authorities

}

}

/* =============================
DOCUMENT GENERATION
============================= */

app.post("/api/generate", auth, generateLimiter, async(req,res)=>{

try{

const user = await prisma.user.findUnique({
where:{id:req.user.userId}
})

if(!user) return res.status(404).json({error:"User not found"})

if(!user.proStatus && user.generationCount>=2){
return res.status(403).json({error:"Free limit exceeded"})
}

const {claimData,format} = req.body

const data = generateClaimText(claimData)

if(!user.proStatus){

await prisma.user.update({
where:{id:user.id},
data:{generationCount:{increment:1}}
})

}

/* ================= PDF */

if(format==="pdf"){

const doc = new PDFDocument({margin:50})

res.setHeader("Content-Type","application/pdf")
res.setHeader("Content-Disposition","attachment; filename=pretension.pdf")

doc.pipe(res)

doc.fontSize(12)

doc.text(`Руководителю ${data.employer.name}`,{align:"right"})
doc.text(`${data.employer.address}`,{align:"right"})

doc.moveDown(2)

doc.text("От:",{align:"left"})
doc.text(data.claimants,{align:"left"})

doc.moveDown(2)

doc.fontSize(16)

doc.text("ДОСУДЕБНАЯ ПРЕТЕНЗИЯ",{align:"center"})

doc.moveDown(2)

doc.fontSize(12)

doc.text("ОБСТОЯТЕЛЬСТВА")
doc.moveDown()

doc.text(data.circumstances.description || "")
doc.moveDown()
doc.text(data.violations)

doc.moveDown()
doc.text(data.evidence)

doc.moveDown()
doc.text(data.law)

doc.moveDown()
doc.text(data.consequences)

doc.moveDown()
doc.text(data.demands)
doc.moveDown()
doc.text(data.authorities)

doc.moveDown()

doc.text(`Дата: ${new Date().toLocaleDateString("ru-RU")}`)

doc.end()

return
}

/* ================= DOCX */

if(format==="docx"){

const doc = new Document({
sections:[{
children:[

new Paragraph({
children:[new TextRun({
text:"ДОСУДЕБНАЯ ПРЕТЕНЗИЯ",
bold:true,
size:32
})]
}),

new Paragraph({ children:[new TextRun("")] }),

new Paragraph({
children:[new TextRun("ОТ ЗАЯВИТЕЛЯ:")]
}),

new Paragraph({
children:[new TextRun(data.claimants)]
}),

new Paragraph({ children:[new TextRun("")] }),

new Paragraph({
children:[new TextRun("ОБСТОЯТЕЛЬСТВА")]
}),

new Paragraph({
children:[new TextRun(data.circumstances.description || "")]
}),

new Paragraph({ children:[new TextRun("")] }),

new Paragraph({
children:[new TextRun(data.violations)]
}),

new Paragraph({
children:[new TextRun(data.evidence)]
}),

new Paragraph({
children:[new TextRun(data.law)]
}),

new Paragraph({
children:[new TextRun(data.consequences)]
}),

new Paragraph({
children:[new TextRun(data.demands)]
}),

new Paragraph({
children:[new TextRun(data.authorities)]
})

]
}]
})
const buffer = await Packer.toBuffer(doc)

res.setHeader("Content-Disposition","attachment; filename=pretension.docx")

res.send(buffer)

return
}

}catch(e){

console.error("Generation error:",e)

res.status(500).json({error:"Generation error"})

}

})

/* =============================
SEARCH BY INN
============================= */

app.post("/api/companyByInn", companySearchLimiter, async(req,res)=>{

try{

const {inn} = req.body

if(!inn){
return res.status(400).json({error:"INN required"})
}

if(companyCache.has(inn)){
return res.json(companyCache.get(inn))
}

const r = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":`Token ${process.env.DADATA_KEY}`
},

body:JSON.stringify({query:inn})

})

const data = await r.json()

companyCache.set(inn,data)

res.json(data)

}catch(e){

console.error("DaData error",e)

res.status(500).json({error:"dadata error"})

}

})
/* =============================
SEARCH BY NAME
============================= */
app.post("/api/companySearch", companySearchLimiter, async(req,res)=>{

try{

const {query} = req.body

if(!query){
return res.status(400).json({error:"query required"})
}

if(companyCache.has(query)){
return res.json(companyCache.get(query))
}

const r = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":`Token ${process.env.DADATA_KEY}`
},

body:JSON.stringify({query})

})

const data = await r.json()

companyCache.set(query,data)

res.json(data)

}catch(e){

console.error("DaData error",e)

res.status(500).json({error:"dadata error"})

}

})

/* ============================= */

/* =============================
CHECK TELEGRAM SUBSCRIPTION
============================= */

app.post("/api/check-subscription", async(req,res)=>{

try{

const {telegramId} = req.body

if(!telegramId){
return res.status(400).json({error:"telegramId required"})
}

const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember`,{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
chat_id:"@LegalProSupport",
user_id:telegramId
})
})

const data = await response.json()

if(
data.result.status==="member" ||
data.result.status==="administrator" ||
data.result.status==="creator"
){
return res.json({subscribed:true})
}

return res.json({subscribed:false})

}catch(e){

console.error("Subscription check error",e)

res.status(500).json({error:"subscription check failed"})

}

})

/* =============================
TELEGRAM LOGIN
============================= */

const crypto = require("crypto")

app.get("/api/auth/telegram-login", async (req, res) => {

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
// Подключаем дополнительные маршруты
app.use('/api/auth', require('./маршруты/auth'))
app.use('/api/health', require('./маршруты/health'))
app.use('/api/webhooks', require('./маршруты/webhooks'))

/* ============================= */

const PORT = process.env.PORT || 8080

async function start(){

await prisma.$connect()

app.listen(PORT,()=>{

console.log("Server running on",PORT)

})

}

start()
