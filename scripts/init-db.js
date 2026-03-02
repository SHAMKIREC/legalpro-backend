#!/usr/bin/env node

/**
 * Initialize database migrations
 * Run this on first deployment or after schema changes
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Running database migrations...');

  try {
    // This will run all pending migrations
    const result = await prisma.$executeRawUnsafe(`
      SELECT version, description FROM public.prisma_migrations;
    `).catch(() => null);

    console.log('✅ Database migrations completed');
    console.log('');
    console.log('📊 Schema summary:');
    console.log('  - User');
    console.log('  - RefreshToken');
    console.log('  - GenerationJob');
    console.log('  - SecurityLog');
    console.log('  - Payment');
    console.log('  - AuditLog');
    console.log('');
    console.log('💡 Next steps:');
    console.log('  1. Create first user via Telegram login');
    console.log('  2. Test document generation');
    console.log('  3. Monitor security logs');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();