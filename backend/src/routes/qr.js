const express = require('express');
const router = express.Router();
const { createQrSvg, createQrDataUri } = require('../utils/qr-generator');
const db = require('../db');

function parseAndValidateUrl(inputUrl, req) {
  if (!inputUrl) {
    return { error: 'Missing url parameter', statusCode: 400 };
  }

  // Reject internal/dashboard routes immediately
  if (
    inputUrl.includes('/#/') ||
    inputUrl.includes('/dashboard') ||
    inputUrl.includes('/admin') ||
    inputUrl.includes('/api/')
  ) {
    return {
      error: 'Cannot generate customer QR code for internal dashboard or administrative routes',
      statusCode: 400
    };
  }

  const publicBase = process.env.PUBLIC_APP_URL ? process.env.PUBLIC_APP_URL.trim().replace(/\/$/, '') : null;
  const isProd = process.env.NODE_ENV === 'production';

  let targetUrl = inputUrl;
  if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
    try {
      const parsed = new URL(inputUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        if (publicBase) {
          targetUrl = `${publicBase}${parsed.pathname}${parsed.search}`;
        } else if (isProd) {
          return {
            error: 'Cannot encode localhost or development URLs in production',
            statusCode: 400
          };
        }
      }
    } catch (_) {
      return { error: 'Invalid URL format', statusCode: 400 };
    }
  } else {
    const proto = (req && (req.headers['x-forwarded-proto'] || req.protocol)) || 'http';
    const host = (req && req.get('host')) || 'localhost:3000';
    const baseUrl = publicBase || `${proto}://${host}`;
    const cleanPath = inputUrl.startsWith('/') ? inputUrl : `/${inputUrl}`;
    targetUrl = `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
  }

  try {
    const parsed = new URL(targetUrl);
    if (isProd && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return {
        error: 'Cannot encode localhost or development URLs in production',
        statusCode: 400
      };
    }
    if (
      parsed.pathname.includes('/dashboard') ||
      parsed.pathname.includes('/admin') ||
      parsed.pathname.includes('/api') ||
      parsed.hash.includes('dashboard')
    ) {
      return {
        error: 'Cannot generate customer QR code for internal dashboard or administrative routes',
        statusCode: 400
      };
    }
    return { url: targetUrl, parsed };
  } catch (_) {
    return { error: 'Invalid resolved URL', statusCode: 400 };
  }
}

function extractFormSlug(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const match = parsed.pathname.match(/\/feedback\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

async function validateFormIfApplicable(slug) {
  if (!slug) return null;
  try {
    const form = await db.getFormBySlug(slug);
    if (form) {
      if (form.status !== 'published') {
        return {
          error: `Cannot generate customer QR code: Form "${form.title || slug}" is ${form.status}. Only published forms can be shared with customers.`,
          statusCode: 400
        };
      }
      return { form };
    }
  } catch (err) {
    // If DB check fails or not connected, allow graceful handling
  }
  return null;
}

// GET /api/qr/form/:slug
router.get('/form/:slug', async (req, res) => {
  const { slug } = req.params;
  const width = parseInt(req.query.size, 10) || 300;

  try {
    const form = await db.getFormBySlug(slug);
    if (!form) {
      return res.status(404).json({ error: `Form "${slug}" not found` });
    }
    if (form.status !== 'published') {
      return res.status(400).json({
        error: `Cannot generate customer QR code: Form "${form.title || slug}" is ${form.status}. Only published forms can be shared with customers.`,
        status: form.status
      });
    }

    const publicBase = process.env.PUBLIC_APP_URL ? process.env.PUBLIC_APP_URL.trim().replace(/\/$/, '') : null;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const baseUrl = publicBase || `${proto}://${host}`;
    const formUrl = `${baseUrl.replace(/\/$/, '')}/feedback/${form.slug}`;

    const dataUrl = await createQrDataUri(formUrl, width);
    res.json({
      success: true,
      slug: form.slug,
      title: form.title,
      status: form.status,
      url: formUrl,
      dataUrl
    });
  } catch (err) {
    console.error('Error generating form QR:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// GET /api/qr/image?url=...&slug=...
router.get('/image', async (req, res) => {
  const { url, slug, size } = req.query;
  const inputUrl = url || (slug ? `/feedback/${slug}` : null);

  const validation = parseAndValidateUrl(inputUrl, req);
  if (validation.error) {
    return res.status(validation.statusCode || 400).send(validation.error);
  }

  const targetUrl = validation.url;
  const targetSlug = slug || extractFormSlug(targetUrl);
  if (targetSlug) {
    const formCheck = await validateFormIfApplicable(targetSlug);
    if (formCheck && formCheck.error) {
      return res.status(formCheck.statusCode || 400).send(formCheck.error);
    }
  }

  try {
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

// GET /api/qr/data-url?url=...&slug=...
router.get('/data-url', async (req, res) => {
  const { url, slug, size } = req.query;
  const inputUrl = url || (slug ? `/feedback/${slug}` : null);

  const validation = parseAndValidateUrl(inputUrl, req);
  if (validation.error) {
    return res.status(validation.statusCode || 400).json({ error: validation.error });
  }

  const targetUrl = validation.url;
  const targetSlug = slug || extractFormSlug(targetUrl);
  if (targetSlug) {
    const formCheck = await validateFormIfApplicable(targetSlug);
    if (formCheck && formCheck.error) {
      return res.status(formCheck.statusCode || 400).json({ error: formCheck.error });
    }
  }

  try {
    const width = parseInt(size, 10) || 300;
    const dataUrl = await createQrDataUri(targetUrl, width);
    res.json({
      success: true,
      dataUrl,
      url: targetUrl,
      slug: targetSlug || null
    });
  } catch (err) {
    console.error('QR code generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
