/**
 * FeedbackHub Backend QR Code Generator
 * Standards-compliant Model 2 QR generation using maintained 'qrcode' library.
 */
const QRCode = require('qrcode');
const svgRenderer = require('qrcode/lib/renderer/svg-tag');

function createQrSvg(text, size = 300) {
  if (!text) {
    throw new Error('Text is required to generate QR code');
  }
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return svgRenderer.render(qr, { width: size, margin: 4 });
}

async function createQrDataUri(text, size = 300) {
  if (!text) {
    throw new Error('Text is required to generate QR code');
  }
  return await QRCode.toDataURL(text, {
    width: size,
    margin: 4,
    errorCorrectionLevel: 'M'
  });
}

function generateMatrix(text, options = {}) {
  if (!text) {
    throw new Error('Text is required to generate QR code matrix');
  }
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M', ...options });
  const size = qr.modules.size;
  const matrix = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      row.push(qr.modules.get(r, c) ? 1 : 0);
    }
    matrix.push(row);
  }
  return matrix;
}

module.exports = {
  createQrSvg,
  createQrDataUri,
  generateMatrix
};
