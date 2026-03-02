const express = require('express');const express = require('express');







module.exports = router;});  res.json({ status: 'ok', timestamp: Date.now() });router.get('/', (req, res) => {const router = express.Router();const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;