# LegalPro Backend API

Production-grade Node.js/Express backend with security hardening.

## Architecture

```
Express App
├── Helmet (Security Headers)
├── CORS (Whitelist)
├── Rate Limiter (Redis-backed)
├── Request Logger (Winston)
├── Routes
│   ├── /auth (JWT + Telegram)
│   ├── /generate (Document Queue)
│   └── /webhooks
├── Prisma ORM
├── PostgreSQL (Primary)
└── Redis (Sessions + Queue)
```

## Security Features

### Authentication
- Telegram WebApp verification
- JWT with automatic rotation
- HttpOnly refresh token cookies
- Shadow token validation (replay attack prevention)

### API Protection
- CSRF token validation (double-submit)
- Request size limits (10KB)
- Rate limiting (Redis-backed)
- SQL injection prevention (Prisma)
- Input validation (express-validator)

### Logging
- Request ID tracing
- Security event logging
- Winston JSON logging
- Production-grade access logs

## Getting Started

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your secrets

# Generate Prisma client
npx prisma generate

# Initialize database
npx prisma migrate deploy

# Run locally
npm run dev

# Run with worker
npm run worker

# Production
npm start
```

## API Documentation

### Authentication Endpoints

#### POST /api/v1/auth/telegram
Login with Telegram WebApp
```json
{
  "initData": "...",
  "initDataUnsafe": {...}
}
→ { "accessToken": "...", "expiresIn": 900, "user": {...} }
```

#### POST /api/v1/auth/refresh
Refresh access token
```
Headers: Cookie: refreshToken=...
→ { "accessToken": "...", "expiresIn": 900 }
```

#### POST /api/v1/auth/logout
Revoke all tokens
```
Headers: Authorization: Bearer ...
→ { "success": true }
```

### Generation Endpoints

#### POST /api/v1/generate
Generate document
```json
{
  "claimData": {...},
  "format": "pdf"
}
→ { "jobId": "...", "status": "processing" }
```

#### GET /api/v1/generate/status/:jobId
Check status
```
→ { "status": "completed", "downloadUrl": "..." }
```

## Performance

### Capacity (2GB instance)
- PDF generation: 4-5 concurrent
- Queue throughput: 12-15 PDF/min
- Database pool: 10-20 connections
- Memory per PDF: ~250-330MB

### Optimization
- Connection pooling (PgBouncer)
- Query result caching
- Request deduplication
- Compression (Brotli)
- Worker scaling

## Monitoring

```bash
# Health check
curl http://localhost:3000/api/v1/health

# View logs
npm run logs

# Check database
npx prisma studio

# Monitor queue
npm run queue:monitor
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Token expired on refresh | Check JWT_REFRESH_SECRET in .env |
| PDF generation timeout | Increase PUPPETEER_TIMEOUT |
| Database connection failed | Verify DATABASE_URL, check pg running |
| Rate limit errors | Configure Redis connection |

## Contributing

```bash
npm run lint      # Check code quality
npm run test      # Run tests
npm run format    # Auto-format code
```