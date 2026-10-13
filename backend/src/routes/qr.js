const express = require('express');
const router = express.Router();
const { createQrSvg, createQrDataUri } = require('../utils/qr-generator');

function resolvePublicUrl(inputUrl, req) {
  if (!inputUrl) return '';
  const publicBase = process.env.PUBLIC_APP_URL ? process.env.PUBLIC_APP_URL.replace(/\/$/, '') : null;

  if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
    if (publicBase) {
      try {
        const parsed = new URL(inputUrl);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return `${publicBase}${parsed.pathname}${parsed.search}`;
        }
      } catch (_) {}
    }
    return inputUrl;
  }
  const baseUrl = publicBase || `${req.protocol}://${req.get('host')}`;
  const cleanPath = inputUrl.startsWith('/') ? inputUrl : `/${inputUrl}`;
  return `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
}

// GET /api/qr/image?url=...
router.get('/image', (req, res) => {
  const { url, size } = req.query;
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const targetUrl = resolvePublicUrl(url, req);
    const width = parseInt(size, 10) || 300;
    const svg = createQrSvg(targetUrl, width);
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
    const targetUrl = resolvePublicUrl(url, req);
    const width = parseInt(size, 10) || 300;
    const dataUrl = createQrDataUri(targetUrl, width);
    res.json({ dataUrl, url: targetUrl });
  } catch (err) {
    console.error('QR code generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
