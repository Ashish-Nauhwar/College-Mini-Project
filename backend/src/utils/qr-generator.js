/**
 * FeedbackHub Backend QR Code Generator
 * Standard Model 2 QR generation with Reed-Solomon Error Correction.
 * Pure Node.js zero external npm dependency.
 */

const { toSvgString, generateMatrix } = require('../../../frontend/js/qr');

function createQrSvg(text, size = 300) {
  return toSvgString(text, size);
}

function createQrDataUri(text, size = 300) {
  const svg = createQrSvg(text, size);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

module.exports = {
  createQrSvg,
  createQrDataUri,
  generateMatrix
};
