#!/usr/bin/env node

/**
 * Generate secure secrets for production
 * Usage: node generate-secrets.js > .env.secrets
 */

const crypto = require('crypto');

function generateSecret(bits = 256) {
  return crypto.randomBytes(bits / 8).toString('hex');
}

console.log('# Generated secrets - Add to .env file');
console.log('# Generated at:', new Date().toISOString());
console.log('');

console.log('# JWT Secrets');
console.log('JWT_ACCESS_SECRET=' + generateSecret(256));
console.log('JWT_REFRESH_SECRET=' + generateSecret(256));
console.log('');

console.log('# Database Password');
console.log('DB_PASSWORD=' + generateSecret(128));
console.log('');

console.log('# Optional: API Key for internal services');
console.log('API_SECRET_KEY=' + generateSecret(256));
console.log('');

console.log('# Note: Paste these values into your .env file');
console.log('# Never commit secrets to version control!');