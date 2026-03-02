#!/usr/bin/env node

/**
 * Development server with hot reload
 * Usage: npm run dev
 */

const nodemon = require('nodemon');

nodemon({
  script: 'server.js',
  watch: ['server.js', 'routes/', 'prisma/'],
  ignore: ['node_modules/', 'storage/', 'logs/'],
  ext: 'js,json',
  env: {
    NODE_ENV: 'development',
    DEBUG: 'legalpro:*'
  },
  exec: 'node',
  delay: 1000,
  verbose: true
});

nodemon
  .on('start', () => {
    console.log('🚀 Server starting...');
  })
  .on('crash', () => {
    console.log('💥 Application crashed, waiting for changes...');
  })
  .on('restart', (files) => {
    console.log('🔄 Restarting due to changes in:', files);
  });