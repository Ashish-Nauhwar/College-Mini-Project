/**
 * FeedbackHub Offline QR Code Generator
 * Zero external CDN dependencies - 100% client-side & offline-capable.
 * Supports standard QR Model 2 with Reed-Solomon Error Correction.
 */
(function (global) {
  'use strict';

  // GF(256) Galois Field tables for Reed-Solomon Error Correction
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = val;
    EXP[i + 255] = val;
    LOG[val] = i;
    val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
  }

  function gfMul(x, y) {
    return x === 0 || y === 0 ? 0 : EXP[LOG[x] + LOG[y]];
  }

  function polyMul(p1, p2) {
    const res = new Uint8Array(p1.length + p2.length - 1);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        res[i + j] ^= gfMul(p1[i], p2[j]);
      }
    }
    return res;
  }

  function polyRemainder(data, gen) {
    const res = new Uint8Array(data);
    for (let i = 0; i < data.length - gen.length + 1; i++) {
      const coef = res[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          res[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return res.slice(data.length - gen.length + 1);
  }

  function getGeneratorPoly(deg) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < deg; i++) {
      poly = polyMul(poly, new Uint8Array([1, EXP[i]]));
    }
    return poly;
  }

  // Version specs: Level M (15% error correction)
  const TABLE = [
    null,
    { v: 1, size: 21, dataCap: 14, ecPerBlock: 10 },
    { v: 2, size: 25, dataCap: 26, ecPerBlock: 16 },
    { v: 3, size: 29, dataCap: 42, ecPerBlock: 26 },
    { v: 4, size: 33, dataCap: 62, ecPerBlock: 36 },
    { v: 5, size: 37, dataCap: 84, ecPerBlock: 48 },
    { v: 6, size: 41, dataCap: 106, ecPerBlock: 64 },
    { v: 7, size: 45, dataCap: 122, ecPerBlock: 72 },
    { v: 8, size: 49, dataCap: 152, ecPerBlock: 88 },
    { v: 9, size: 53, dataCap: 180, ecPerBlock: 110 },
    { v: 10, size: 57, dataCap: 213, ecPerBlock: 130 }
  ];

  function encodeStringToUtf8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    const arr = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code < 0x80) arr.push(code);
      else if (code < 0x800) {
        arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(arr);
  }

  function generateMatrix(text) {
    const bytes = encodeStringToUtf8(text);
    let spec = null;
    for (let v = 1; v <= 10; v++) {
      if (bytes.length <= TABLE[v].dataCap) {
        spec = TABLE[v];
        break;
      }
    }
    if (!spec) spec = TABLE[10];

    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }

    pushBits(0b0100, 4); // Byte mode indicator
    pushBits(bytes.length, 8); // Character count
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

    const totalDataBits = spec.dataCap * 8;
    for (let i = 0; i < 4 && bits.length < totalDataBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const pad = [0xec, 0x11];
    let padIdx = 0;
    while (bits.length < totalDataBits) {
      pushBits(pad[padIdx % 2], 8);
      padIdx++;
    }

    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataBytes.push(b);
    }

    // Reed-Solomon error correction codewords
    const gen = getGeneratorPoly(spec.ecPerBlock);
    const dataWithPadding = new Uint8Array(dataBytes.length + spec.ecPerBlock);
    dataWithPadding.set(dataBytes);
    const ecBytes = polyRemainder(dataWithPadding, gen);

    const finalCodewords = [...dataBytes, ...ecBytes];

    // Build grid
    const N = spec.size;
    const matrix = Array.from({ length: N }, () => Array(N).fill(null));
    const isReserved = Array.from({ length: N }, () => Array(N).fill(false));

    function setMod(r, c, val) {
      matrix[r][c] = val;
      isReserved[r][c] = true;
    }

    // 7x7 Finders
    function addFinder(r0, c0) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r, cc = c0 + c;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N) {
            const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
            const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            const isOuter = (r === -1 || r === 7 || c === -1 || c === 7);
            setMod(rr, cc, (!isOuter && (isBorder || isCenter)));
          }
        }
      }
    }
    addFinder(0, 0);
    addFinder(0, N - 7);
    addFinder(N - 7, 0);

    // Timing patterns
    for (let i = 8; i < N - 8; i++) {
      if (matrix[6][i] === null) setMod(6, i, i % 2 === 0);
      if (matrix[i][6] === null) setMod(i, 6, i % 2 === 0);
    }

    // Dark module
    setMod(4 * spec.v + 9, 8, true);

    // Alignment patterns for V2+
    if (spec.v >= 2) {
      const alignCenters = [6, spec.size - 7];
      for (let ar of alignCenters) {
        for (let ac of alignCenters) {
          if (isReserved[ar][ac]) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              const border = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
              setMod(ar + r, ac + c, border);
            }
          }
        }
      }
    }

    // Reserve Format Info
    for (let i = 0; i < 9; i++) {
      if (!isReserved[8][i]) isReserved[8][i] = true;
      if (!isReserved[i][8]) isReserved[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      if (!isReserved[8][N - 1 - i]) isReserved[8][N - 1 - i] = true;
      if (!isReserved[N - 1 - i][8]) isReserved[N - 1 - i] = true;
    }

    // Fill data bits in zig-zag
    let bitIdx = 0;
    const allBits = [];
    for (let cw of finalCodewords) {
      for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);
    }

    let upwards = true;
    for (let right = N - 1; right > 0; right -= 2) {
      if (right === 6) right--; // skip timing col
      const rows = upwards
        ? Array.from({ length: N }, (_, i) => N - 1 - i)
        : Array.from({ length: N }, (_, i) => i);

      for (let r of rows) {
        for (let c of [right, right - 1]) {
          if (!isReserved[r][c]) {
            const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
            const mask = (r + c) % 2 === 0;
            matrix[r][c] = (bit ^ (mask ? 1 : 0)) === 1;
          }
        }
      }
      upwards = !upwards;
    }

    // Format bits for EC=M, Mask 0
    const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
    for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i] === 1;
    matrix[8][7] = formatBits[6] === 1;
    matrix[8][8] = formatBits[7] === 1;
    matrix[7][8] = formatBits[8] === 1;
    for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i] === 1;

    for (let i = 0; i < 7; i++) matrix[N - 1 - i][8] = formatBits[i] === 1;
    for (let i = 7; i < 15; i++) matrix[8][N - 15 + i] = formatBits[i] === 1;

    return matrix;
  }

  function toCanvas(canvas, text, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};
    const width = options.width || 260;
    const margin = options.margin !== undefined ? options.margin : 2;
    const dark = (options.color && options.color.dark) || '#0f172a';
    const light = (options.color && options.color.light) || '#ffffff';

    try {
      const matrix = generateMatrix(text);
      const count = matrix.length;
      const totalModules = count + margin * 2;
      const moduleSize = Math.floor(width / totalModules);
      const canvasSize = moduleSize * totalModules;

      canvas.width = canvasSize;
      canvas.height = canvasSize;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, canvasSize, canvasSize);

      ctx.fillStyle = dark;
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (matrix[r][c]) {
            ctx.fillRect(
              (c + margin) * moduleSize,
              (r + margin) * moduleSize,
              moduleSize,
              moduleSize
            );
          }
        }
      }

      if (typeof callback === 'function') callback(null, canvas);
      return canvas;
    } catch (err) {
      if (typeof callback === 'function') callback(err);
      else console.error('QR code generation failed:', err);
    }
  }

  function toSvgString(text, size = 260) {
    const matrix = generateMatrix(text);
    const count = matrix.length;
    const margin = 2;
    const total = count + margin * 2;
    const cellSize = (size / total).toFixed(2);

    let rects = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (matrix[r][c]) {
          const x = ((c + margin) * (size / total)).toFixed(2);
          const y = ((r + margin) * (size / total)).toFixed(2);
          rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#0f172a"/>`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#ffffff"/>${rects}</svg>`;
  }

  const QRCodeLib = {
    toCanvas,
    toSvgString,
    generateMatrix
  };

  global.QRCode = QRCodeLib;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QRCodeLib;
  }
})(typeof window !== 'undefined' ? window : globalThis);
