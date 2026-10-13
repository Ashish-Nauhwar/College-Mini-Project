const express = require('express');
const router = express.Router();
const { createQrSvg, createQrDataUri } = require('../utils/qr-generator');

// GET /api/qr/image?url=...
router.get('/image', (req, res) => {
  const { url, size } = req.query;
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const width = parseInt(size, 10) || 300;
    const svg = createQrSvg(url, width);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', 'inline; filename="feedback-qr.svg"');
    res.send(svg);
  } catch (err) {
    console.error('QR code generation error:', err);
    res.status(500).send('Failed to generate QR code');
  }
});

// GET /api/qr/data-url?url=...
router.get('/data-url', (req, res) => {
  const { url, size } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const width = parseInt(size, 10) || 300;
    const dataUrl = createQrDataUri(url, width);
    res.json({ dataUrl, url });
  } catch (err) {
    console.error('QR code generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
