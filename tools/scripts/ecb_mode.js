// ─── State ────────────────────────────────────────────────────────────────────
let originalBmpBytes = null;
let encryptedBmpBytes = null;
let currentAlgo = 'AES-128';
let logEntries = 0;

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg, type = 'ok') {
  const body = document.getElementById('logBody');
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8);
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-ts">[${ts}]</span><span class="log-${type}">${msg}</span>`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  logEntries++;
  document.getElementById('logCount').textContent = `${logEntries} entries`;
}

// ─── Key Generation ───────────────────────────────────────────────────────────
function generateKey(bits = 128) {
  const bytes = bits / 8;
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return arr;
}

function keyToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function setNewKey() {
  const bits = currentAlgo === 'AES-256' ? 256 : 128;
  const k = generateKey(bits);
  document.getElementById('keyInput').value = keyToHex(k);
  document.getElementById('keyInput')._keyBytes = k;
  log(`Generated ${bits}-bit key: ${keyToHex(k).slice(0, 16)}...`, 'ok');
}

// ─── BMP Parsing ──────────────────────────────────────────────────────────────
function parseBmpHeader(data) {
  const view = new DataView(data.buffer);
  const sig = String.fromCharCode(data[0], data[1]);
  if (sig !== 'BM') throw new Error('Not a valid BMP file (missing BM signature)');
  const fileSize     = view.getUint32(2,  true);
  const pixelOffset  = view.getUint32(10, true);
  const dibSize      = view.getUint32(14, true);
  const width        = view.getInt32(18,  true);
  const height       = view.getInt32(22,  true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression  = view.getUint32(30, true);
  return { fileSize, pixelOffset, dibSize, width, height, bitsPerPixel, compression, sig };
}

// ─── Rendering BMP to Canvas ──────────────────────────────────────────────────
function renderBmpToCanvas(bmpBytes, containerId, metaId, label) {
  const container = document.getElementById(containerId);
  const meta = document.getElementById(metaId);

  try {
    const hdr = parseBmpHeader(bmpBytes);
    meta.textContent = `${hdr.width}×${Math.abs(hdr.height)}px  ${hdr.bitsPerPixel}bpp`;

    const blob = new Blob([bmpBytes], { type: 'image/bmp' });
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.style.cssText = 'display:block;width:100%;max-height:420px;object-fit:contain;background:#000;image-rendering:pixelated;';
    img.onload = () => URL.revokeObjectURL(url);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      renderBmpManual(bmpBytes, container, hdr);
    };
    img.src = url;
    container.innerHTML = '';
    container.appendChild(img);
    log(`${label}: ${hdr.width}×${Math.abs(hdr.height)} px, ${hdr.bitsPerPixel}-bit`, 'ok');
  } catch (e) {
    container.innerHTML = `<div class="placeholder"><span style="color:var(--red)">${e.message}</span></div>`;
    meta.textContent = 'ERROR';
    log(e.message, 'err');
  }
}

function renderBmpManual(bmpBytes, container, hdr) {
  const W = hdr.width, H = Math.abs(hdr.height);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;max-height:420px;object-fit:contain;background:#000;image-rendering:pixelated;';
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(W, H);
  const pixels = imgData.data;
  const flipped = hdr.height > 0;
  const offset = hdr.pixelOffset;

  if (hdr.bitsPerPixel === 24) {
    const rowSize = Math.floor((24 * W + 31) / 32) * 4;
    for (let row = 0; row < H; row++) {
      const srcRow = flipped ? (H - 1 - row) : row;
      for (let col = 0; col < W; col++) {
        const src = offset + srcRow * rowSize + col * 3;
        const dst = (row * W + col) * 4;
        pixels[dst]     = bmpBytes[src + 2];
        pixels[dst + 1] = bmpBytes[src + 1];
        pixels[dst + 2] = bmpBytes[src];
        pixels[dst + 3] = 255;
      }
    }
  } else if (hdr.bitsPerPixel === 8) {
    const palOffset = 14 + hdr.dibSize;
    const palette = [];
    for (let i = 0; i < 256; i++) {
      palette.push([
        bmpBytes[palOffset + i * 4 + 2],
        bmpBytes[palOffset + i * 4 + 1],
        bmpBytes[palOffset + i * 4 + 0],
      ]);
    }
    const rowSize = Math.floor((8 * W + 31) / 32) * 4;
    for (let row = 0; row < H; row++) {
      const srcRow = flipped ? (H - 1 - row) : row;
      for (let col = 0; col < W; col++) {
        const idx = bmpBytes[offset + srcRow * rowSize + col];
        const dst = (row * W + col) * 4;
        const [r, g, b] = palette[idx];
        pixels[dst] = r; pixels[dst + 1] = g; pixels[dst + 2] = b; pixels[dst + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  container.innerHTML = '';
  container.appendChild(canvas);
}

// ─── AES-ECB via Web Crypto ───────────────────────────────────────────────────
async function aesEcbEncrypt(keyBytes, dataBytes) {
  const keyLen = keyBytes.length * 8;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'AES-CBC', length: keyLen },
    false, ['encrypt']
  );

  const BLOCK = 16;
  const out = new Uint8Array(dataBytes.length);
  const nullIV = new ArrayBuffer(16);
  const batchSize = 256;
  const totalBlocks = Math.floor(dataBytes.length / BLOCK);

  for (let b = 0; b < totalBlocks; b += batchSize) {
    const end = Math.min(b + batchSize, totalBlocks);
    const promises = [];
    for (let i = b; i < end; i++) {
      const block = dataBytes.slice(i * BLOCK, (i + 1) * BLOCK);
      promises.push(
        crypto.subtle.encrypt({ name: 'AES-CBC', iv: nullIV }, cryptoKey, block)
          .then(ct => { out.set(new Uint8Array(ct, 0, BLOCK), i * BLOCK); })
      );
    }
    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 0));

    const pct = Math.round((end / totalBlocks) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressLabel').textContent = `Encrypting... ${pct}%`;
  }

  const rem = dataBytes.length % BLOCK;
  if (rem > 0) {
    out.set(dataBytes.slice(totalBlocks * BLOCK), totalBlocks * BLOCK);
  }

  return out;
}

// ─── XOR cipher ───────────────────────────────────────────────────────────────
function xorEncrypt(keyBytes, dataBytes) {
  const out = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    out[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

// ─── 24-bit → 8-bit Grayscale BMP ────────────────────────────────────────────
function convertTo8bitGrayscale(bmpBytes) {
  const hdr = parseBmpHeader(bmpBytes);
  if (hdr.bitsPerPixel !== 24 && hdr.bitsPerPixel !== 8)
    throw new Error('Only 24-bit or 8-bit BMPs supported');
  if (hdr.compression !== 0)
    throw new Error('Compressed BMPs not supported. Use uncompressed BMP.');
  if (hdr.bitsPerPixel === 8) return bmpBytes;

  const W = hdr.width, H = Math.abs(hdr.height);
  const flipped = hdr.height > 0;
  const srcRowSize = Math.floor((24 * W + 31) / 32) * 4;
  const dstRowSize = Math.floor((8  * W + 31) / 32) * 4;

  const newPixelOffset = 54 + 1024;
  const newFileSize = newPixelOffset + dstRowSize * H;
  const out = new Uint8Array(newFileSize);
  const view = new DataView(out.buffer);

  // File header
  out[0] = 0x42; out[1] = 0x4D;
  view.setUint32(2,  newFileSize,    true);
  view.setUint32(6,  0,             true);
  view.setUint32(10, newPixelOffset, true);

  // DIB header
  view.setUint32(14, 40,              true);
  view.setInt32 (18, W,               true);
  view.setInt32 (22, -H, true); // output pixels are always written top-down
  view.setUint16(26, 1,              true);
  view.setUint16(28, 8,              true);
  view.setUint32(30, 0,              true);
  view.setUint32(34, dstRowSize * H, true);
  view.setInt32 (38, 2835,           true);
  view.setInt32 (42, 2835,           true);
  view.setUint32(46, 256,            true);
  view.setUint32(50, 256,            true);

  // Grayscale palette
  for (let i = 0; i < 256; i++) {
    const p = 54 + i * 4;
    out[p] = i; out[p + 1] = i; out[p + 2] = i; out[p + 3] = 0;
  }

  // Pixels
  for (let row = 0; row < H; row++) {
    const srcRow = flipped ? (H - 1 - row) : row;
    for (let col = 0; col < W; col++) {
      const src = hdr.pixelOffset + srcRow * srcRowSize + col * 3;
      const gray = Math.round(
        0.299 * bmpBytes[src + 2] +
        0.587 * bmpBytes[src + 1] +
        0.114 * bmpBytes[src]
      );
      out[newPixelOffset + row * dstRowSize + col] = gray;
    }
  }

  return out;
}

// ─── Main Encrypt Flow ────────────────────────────────────────────────────────
async function encryptBmp() {
  if (!originalBmpBytes) return;

  const algo = currentAlgo;
  const pixFmt = document.getElementById('pixelFormat').value;
  const keyBytes = document.getElementById('keyInput')._keyBytes;

  document.getElementById('encryptBtn').disabled = true;
  document.getElementById('progressWrap').classList.add('visible');
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('stat-status').textContent = 'Processing';

  try {
    log(`Starting ECB encryption — algo: ${algo}`, 'ok');

    let workBytes = new Uint8Array(originalBmpBytes);

    if (pixFmt === '8' || pixFmt === '8xor') {
      const hdr = parseBmpHeader(workBytes);
      if (hdr.bitsPerPixel === 24) {
        log('Converting 24-bit → 8-bit grayscale...', 'warn');
        workBytes = convertTo8bitGrayscale(workBytes);
        log('Conversion complete', 'ok');
      }
    }

    const hdr = parseBmpHeader(workBytes);
    const pixelOffset = hdr.pixelOffset;
    const pixelData = workBytes.slice(pixelOffset);
    const header = workBytes.slice(0, pixelOffset);

    log(`Header: ${pixelOffset} bytes | Pixel data: ${pixelData.length} bytes`, 'ok');
    log(`Block size: ${algo === 'XOR' || pixFmt === '8xor' ? '1 byte (XOR)' : '16 bytes (AES)'} | ${hdr.width}×${Math.abs(hdr.height)} px`, 'ok');

    let encPixels;
    if (algo === 'XOR' || pixFmt === '8xor') {
      encPixels = xorEncrypt(keyBytes, pixelData);
      document.getElementById('progressBar').style.width = '100%';
    } else {
      encPixels = await aesEcbEncrypt(keyBytes, pixelData);
    }

    const result = new Uint8Array(header.length + encPixels.length);
    result.set(header, 0);
    result.set(encPixels, header.length);
    encryptedBmpBytes = result;

    log('Encryption complete — rendering output...', 'ok');
    renderBmpToCanvas(result, 'encContainer', 'encMeta', 'Encrypted');
    document.getElementById('downloadBtn').classList.add('visible');
    document.getElementById('stat-status').textContent = 'Complete';

    const blockSz = (algo === 'XOR' || pixFmt === '8xor') ? 1 : 16;
    const bytesPerPx = hdr.bitsPerPixel / 8;
    const pxPerBlock = blockSz / bytesPerPx;
    log(`Visual resolution: ~${pxPerBlock.toFixed(1)} pixels per encrypted block`, 'ok');

  } catch (e) {
    log(e.message, 'err');
    document.getElementById('stat-status').textContent = 'Error';
  } finally {
    document.getElementById('encryptBtn').disabled = false;
    document.getElementById('progressWrap').classList.remove('visible');
  }
}

// ─── File Loading ─────────────────────────────────────────────────────────────
function loadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.bmp') && file.type !== 'image/bmp') {
    log(`Rejected: "${file.name}" is not a BMP file`, 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    originalBmpBytes = new Uint8Array(e.target.result);
    encryptedBmpBytes = null;
    document.getElementById('downloadBtn').classList.remove('visible');
    document.getElementById('encContainer').innerHTML =
      '<div class="placeholder"><span class="ph-icon">▨</span><span>Press encrypt</span></div>';
    document.getElementById('encMeta').textContent = '—';

    try {
      parseBmpHeader(originalBmpBytes);
      log(`Loaded: "${file.name}" — ${(file.size / 1024).toFixed(1)} KB`, 'ok');
      renderBmpToCanvas(originalBmpBytes, 'origContainer', 'origMeta', 'Original');
      document.getElementById('encryptBtn').disabled = false;
      document.getElementById('stat-status').textContent = 'File loaded';
    } catch (err) {
      log(err.message, 'err');
      originalBmpBytes = null;
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Algorithm info map ───────────────────────────────────────────────────────
const algoInfoMap = {
  'AES-128': `<strong>AES-128 ECB</strong> — 128-bit key, 16-byte blocks.<br>On 8-bit BMP: each block covers <strong>16 pixels</strong> per row. Identical pixel runs → identical ciphertext.`,
  'AES-256': `<strong>AES-256 ECB</strong> — 256-bit key, still 16-byte blocks.<br>Same visual resolution as AES-128, but a stronger key. The pattern effect is identical.`,
  'XOR':     `<strong>XOR-8</strong> — 128-bit repeating key XORed byte by byte.<br>Effective block size = <strong>1 byte = 1 pixel</strong> (8-bit BMP). Maximum detail. Also demonstrates why XOR with a short key is trivially broken.`,
};

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!encryptedBmpBytes) return;
  const blob = new Blob([encryptedBmpBytes], { type: 'image/bmp' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ecb_encrypted.bmp';
  a.click();
  URL.revokeObjectURL(url);
  log('Downloaded: ecb_encrypted.bmp', 'ok');
});

document.getElementById('algoGroup').querySelectorAll('label').forEach(lbl => {
  lbl.addEventListener('click', () => {
    document.getElementById('algoGroup').querySelectorAll('label').forEach(l => l.classList.remove('active'));
    lbl.classList.add('active');
    currentAlgo = lbl.dataset.val;
    document.getElementById('stat-engine').textContent = currentAlgo;
    document.getElementById('algoInfo').innerHTML = algoInfoMap[currentAlgo];

    if (currentAlgo === 'XOR') {
      document.getElementById('pixelFormat').value = '8xor';
    } else if (document.getElementById('pixelFormat').value === '8xor') {
      document.getElementById('pixelFormat').value = '8';
    }

    setNewKey();
  });
});

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

document.getElementById('fileInput').addEventListener('change', e => loadFile(e.target.files[0]));
document.getElementById('genKeyBtn').addEventListener('click', setNewKey);
document.getElementById('encryptBtn').addEventListener('click', encryptBmp);

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  setNewKey();
  document.getElementById('stat-engine').textContent = 'AES-128';
  log('ECB Mode Visualizer ready', 'ok');
  log('Load a BMP file to begin', 'ok');
})();