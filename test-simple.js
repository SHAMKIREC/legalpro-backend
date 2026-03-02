require('dotenv').config();
const express = require('express');

const app = express();
const PORT = 3000;

console.log('[TEST] Creating Express app');
app.use(express.json());

console.log('[TEST] Registering route');
app.get('/api/health', (req, res) => {
  console.log('[TEST] Health endpoint called');
  res.json({ status: 'ok' });
});

console.log('[TEST] Starting listen');
const server = app.listen(PORT, () => {
  console.log(`[TEST] Server listening on port ${PORT}`);
});

console.log('[TEST] Registering SIGINT handler');
process.on('SIGINT', () => {
  console.log('[TEST] SIGINT received');
  server.close(() => {
    console.log('[TEST] Server closed');
    process.exit(0);
  });
});

console.log('[TEST] Boot complete, server should be alive');
// Keep the process alive
setInterval(() => {
  // This keeps the event loop alive
}, 1000);
