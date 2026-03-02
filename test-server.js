const http = require('http');

const server = http.createServer((req, res) => {
  console.log('Request received:', req.method, req.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

server.listen(3000, () => {
  console.log('Server is running on port 3000');
  console.log('Test with: curl http://localhost:3000/');
});

process.on('SIGINT', () => {
  console.log('Server shutting down...');
  server.close();
  process.exit(0);
});
