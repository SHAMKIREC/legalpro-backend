// Simple healthcheck script for Docker
const http = require('http');

const options = {
  method: 'GET',
  host: 'localhost',
  port: process.env.PORT || 3000,
  path: '/api/v1/health'
};

const req = http.request(options, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('error', () => process.exit(1));
req.end();