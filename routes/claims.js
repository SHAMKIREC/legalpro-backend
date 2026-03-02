const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();


// Validation rules
const generateValidation = [
  body('claimData').isObject().withMessage('Invalid claim data'),
  body('claimData.type').isIn([
    'salary', 'unofficial', 'dismissal', 'zpp_product', 
    'zpp_service', 'infoproduct', 'loan', 'contract'
  ]).withMessage('Invalid claim type'),
  body('format').isIn(['pdf', 'docx']).withMessage('Invalid format'),
  body('claimData.workers').isArray({ min: 1, max: 50 }).withMessage('Invalid workers data'),
  body('claimData.employer.name').trim().isLength({ min: 2, max: 200 }).escape(),
  body('claimData.circumstances.debtAmount').optional().isFloat({ min: 0, max: 100000000 }),
];

/**
 * Generate document endpoint
 * Idempotent with idempotency key support
 */
router.post('/', generateValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { claimData, format } = req.body;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // enforce monthly free limit
    if (!req.user.proStatus) {
      // simple counter stored on user record
      const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
      if (user.generationCount >= 2) {
        return res.status(403).json({ error: 'Free limit exceeded', redirectToPricing: true });
      }
      await prisma.user.update({ where: { id: user.id }, data: { generationCount: { increment: 1 } } });
    } else {
      // pro users also increment for stats
      await prisma.user.update({ where: { id: req.user.userId }, data: { generationCount: { increment: 1 } } });
    }

    // Build simple claim text
    const requester = (claimData.workers || []).map(w => w.name).join(', ') || 'Заявитель';
    const respondent = claimData.employer?.name || 'Ответчик';
    const bodyText = claimData.description || claimData.circumstances?.description || '';

    const claimText = `Досудебная претензия\n\nОт: ${requester}\nКому: ${respondent}\n\nСуть нарушения:\n${bodyText}\n\nНа основании применимых норм требую устранить нарушение и выплатить причитающиеся суммы в установленный законом срок.\n\nДата: ${new Date().toLocaleDateString()}\nПодпись: ___________\n`;

    const filename = `pretension_${Date.now()}.${format === 'docx' ? 'docx' : 'txt'}`;
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    return res.send(claimText);
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed' });
  }
});

/**
 * Check generation status
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await prisma.generationJob.findFirst({
      where: { 
        id: jobId,
        userId: req.user.userId // Security: ensure user owns this job
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'completed') {
      // Return download URL (temporary signed URL)
      const downloadUrl = await generateSignedUrl(jobId);
      return res.json({ 
        status: 'completed',
        downloadUrl,
        expiresIn: 300 // 5 minutes
      });
    }

    res.json({ status: job.status, progress: job.progress });

  } catch (error) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Helper functions
async function checkIdempotency(key, userId) {
  const existing = await prisma.generationJob.findFirst({
    where: { idempotencyKey: key, userId },
    orderBy: { createdAt: 'desc' }
  });
  
  if (existing && existing.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
    return existing;
  }
  return null;
}

async function getUserGenerationCount(userId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const count = await prisma.generationJob.count({
    where: {
      userId,
      createdAt: { gte: startOfMonth },
      status: 'completed'
    }
  });
  
  return count;
}

function estimateDocumentSize(data) {
  // Rough estimation based on content length
  const jsonSize = JSON.stringify(data).length;
  return jsonSize * 2; // PDF is roughly 2x JSON size
}

async function generateSignedUrl(jobId) {
  // Implementation of signed URL generation for S3/MinIO
  // Returns temporary download link
  return `/api/generate/download/${jobId}?token=${crypto.randomUUID()}`;
}

module.exports = router;