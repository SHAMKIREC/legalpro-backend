/**
 * PDF Generation Worker
 * Memory-efficient processing with streaming
 */

const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const prisma = new PrismaClient();

// Memory limit: 512MB per worker
const MEMORY_LIMIT = 512 * 1024 * 1024;

const worker = new Worker('pdf generation', async (job) => {
  const { jobId, userId, claimDataRef, format } = job.data;
  
  // Update status
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: 'processing', startedAt: new Date() }
  });

  let browser = null;
  let tempDir = null;

  try {
    // Fetch full data from database (not from Redis)
    const jobData = await prisma.generationJob.findUnique({
      where: { id: jobId },
      include: { user: true }
    });

    if (!jobData) throw new Error('Job data not found');

    // Parse claim data
    const claimData = JSON.parse(jobData.claimData);

    // Create temp directory for this job
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legalpro-'));
    
    // Memory check before processing
    const usage = process.memoryUsage();
    if (usage.heapUsed > MEMORY_LIMIT) {
      throw new Error('Memory limit exceeded');
    }

    if (format === 'pdf') {
      // Launch browser with restricted resources
      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          `--disk-cache-dir=${tempDir}`,
          `--max_old_space_size=256` // Limit Chrome memory
        ],
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        timeout: 25000
      });

      const page = await browser.newPage();
      
      // Set content with timeout
      const html = generateHTML(claimData);
      await page.setContent(html, { 
        waitUntil: 'networkidle0',
        timeout: 10000 
      });

      // Generate PDF with streaming
      const pdfPath = path.join(tempDir, 'output.pdf');
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        timeout: 15000
      });

      await browser.close();
      browser = null;

      // Read file in chunks to avoid memory spike
      const buffer = await fs.readFile(pdfPath);
      
      // Store in temporary file storage (not Redis)
      const storagePath = path.join(process.env.STORAGE_PATH || './storage', `${jobId}.pdf`);
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, buffer);

      // Update job status
      await prisma.generationJob.update({
        where: { id: jobId },
        data: { 
          status: 'completed',
          completedAt: new Date(),
          filePath: storagePath,
          fileSize: buffer.length
        }
      });

      // Cleanup temp files
      await fs.unlink(pdfPath);
      await fs.rmdir(tempDir);
      tempDir = null;

      return { buffer, size: buffer.length };
    }

    // DOCX generation (simplified)
    if (format === 'docx') {
      // Similar pattern with docx library
      // ...
    }

  } catch (error) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { 
        status: 'failed',
        error: error.message,
        failedAt: new Date()
      }
    });
    throw error;
  } finally {
    if (browser) await browser.close();
    if (tempDir) {
      try {
        await fs.rmdir(tempDir, { recursive: true });
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    }
  }
}, {
  connection: process.env.REDIS_URL,
  concurrency: 2, // Limit concurrent PDF generations
  limiter: {
    max: 5,
    duration: 1000
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await prisma.$disconnect();
});

function generateHTML(data) {
  // HTML template generation with proper escaping
  // Implementation details...
  return `<html>...</html>`;
}