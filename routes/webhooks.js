const express = require('express');
const router = express.Router();

// Placeholder webhook endpoints
router.post('/telegram', (req, res) => {
  // handle telegram webhook
  res.sendStatus(200);
});

router.post('/payment', (req, res) => {
  // handle payment provider webhook
  res.sendStatus(200);
});

module.exports = router;