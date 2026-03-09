const express = require('express')
const router = express.Router()

router.post('/telegram', (req, res) => {
  console.log("Telegram webhook")
  res.sendStatus(200)
})

router.post('/payment', (req, res) => {
  console.log("Payment webhook")
  res.sendStatus(200)
})

module.exports = router
