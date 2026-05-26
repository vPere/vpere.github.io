import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7/dist/full.esm.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allMeta = {};
let flatMeta = [];
let currentFile = null;

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(v) {
  if (v === null || v === undefined) return '<span style="color:var(--text-faint)">null</span>';
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `<span class="pill pill-gray">Binary (${v.byteLength ?? v.length} bytes)</span>`;
  if (Array.isArray(v)) {
    if (v.length > 8) return `[${v.slice(0, 6).map(fmt).join(', ')} … +${v.length - 6}]`;
    return `[${v.map(fmt).join(', ')}]`;
  }
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', ' UTC');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function flatten(obj, prefix = '') {
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array) && !(v instanceof ArrayBuffer) && !Array.isArray(v)) {
      rows.push(...flatten(v, key));
    } else {
      rows.push({ key, val: v });
    }
  }
  return rows;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Load & Parse ──────────────────────────────────────────────────────────────
async function loadFile(file) {
  currentFile = file;
  document.getElementById('emptyState').style.display = 'none';
  const ui = document.getElementById('mainUI');
  ui.style.display = 'flex';
  ui.style.flexDirection = 'column';

  // Preview
  const url = URL.createObjectURL(file);
  const img = document.getElementById('previewImg');
  img.src = url;
  document.getElementById('previewWrap').classList.add('visible');
  document.getElementById('dropZone').style.display = 'none';

  // Parse
  try {
    const parsed = await exifr.parse(file, {
      tiff: true, xmp: true, iptc: true, icc: true, jfif: true,
      ihdr: true, exif: true, gps: true, interop: true, makerNote: true,
      multiSegment: true, mergeOutput: false, translateKeys: true,
      translateValues: true, reviveValues: true, sanitize: true
    });

    allMeta = parsed || {};

    // Also get GPS separately for reliability
    const gps = await exifr.gps(file).catch(() => null);
    if (gps && gps.latitude != null) {
      if (!allMeta.gps) allMeta.gps = {};
      allMeta.gps._latitude  = gps.latitude;
      allMeta.gps._longitude = gps.longitude;
    }

    // Flat list for search
    flatMeta = flatten(allMeta);

    // File summary
    renderFileSummary(file, img);
    document.getElementById('countStructured').textContent = flatMeta.length;

    // Render panels
    renderStructured();
    renderAuthorship();
    renderLocation();
    renderSteg(file, img);
    renderRaw();
    renderForensics();
    renderGroupFilter();

    document.getElementById('actionsPanel').style.display = 'block';
    document.getElementById('forensicsPanel').style.display = 'block';

  } catch (e) {
    document.getElementById('structuredContent').innerHTML =
      `<div style="color:var(--red);font-family:DM Mono,monospace;font-size:.8rem;padding:20px">Error parsing metadata: ${e.message}</div>`;
  }
}

// ── File Summary ──────────────────────────────────────────────────────────────
function renderFileSummary(file, imgEl) {
  imgEl.onload = () => {
    const ext = file.name.split('.').pop().toUpperCase();
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    document.getElementById('fileSummary').innerHTML = `
      <div class="summary-row"><span class="summary-key">FILENAME</span><span class="summary-val" title="${file.name}">${file.name}</span></div>
      <div class="summary-row"><span class="summary-key">FORMAT</span><span class="summary-val"><span class="pill pill-purple">${ext}</span></span></div>
      <div class="summary-row"><span class="summary-key">SIZE</span><span class="summary-val">${fmtFileSize(file.size)}</span></div>
      <div class="summary-row"><span class="summary-key">DIMENSIONS</span><span class="summary-val">${w} × ${h} px</span></div>
      <div class="summary-row"><span class="summary-key">LAST MODIFIED</span><span class="summary-val">${new Date(file.lastModified).toLocaleDateString()}</span></div>
    `;
  };
}

// ── Structured Panel ──────────────────────────────────────────────────────────
function renderStructured(filter = '', groupFilter = '') {
  const container = document.getElementById('structuredContent');
  if (!Object.keys(allMeta).length) {
    container.innerHTML = '<div style="color:var(--text-faint);font-size:.8rem;padding:20px">No metadata found in this file.</div>';
    return;
  }

  const groupColors = {
    exif: '#a855f7', iptc: '#60a5fa', xmp: '#4ade80', gps: '#fbbf24',
    jfif: '#f87171', icc: '#e879f9', ihdr: '#34d399', tiff: '#fb923c'
  };

  let html = '';
  for (const [group, data] of Object.entries(allMeta)) {
    if (!data || typeof data !== 'object') continue;
    if (groupFilter && group !== groupFilter) continue;

    const rows = flatten(data);
    const filtered = filter
      ? rows.filter(r => r.key.toLowerCase().includes(filter) || String(r.val).toLowerCase().includes(filter))
      : rows;
    if (!filtered.length) continue;

    const dot = groupColors[group] || 'var(--purple)';
    html += `<div class="meta-group">
      <div class="group-header">
        <div class="group-dot" style="background:${dot}"></div>
        <span class="group-title">${group.toUpperCase()}</span>
        <span class="group-count">${filtered.length} fields</span>
      </div>
      <table class="meta-table">`;

    for (const { key, val } of filtered) {
      const isCoord = (key.includes('latitude') || key.includes('longitude') || key.includes('Latitude') || key.includes('Longitude')) && typeof val === 'number';
      const isDate  = val instanceof Date;
      const isBin   = val instanceof Uint8Array || val instanceof ArrayBuffer;
      let display   = '';

      if (isBin) {
        display = `<span class="pill pill-gray">Binary · ${val.byteLength ?? val.length} bytes</span>`;
      } else if (isCoord) {
        display = `<span class="meta-val coord-link" onclick="openMap(${val}, '${key}')">${val.toFixed(6)}</span>`;
      } else if (isDate) {
        display = `<span class="meta-val highlighted">${fmt(val)}</span>`;
      } else {
        display = `<span class="meta-val">${fmt(val)}</span>`;
      }

      html += `<tr>
        <td class="meta-key">${escHtml(key)}</td>
        <td>${display}</td>
      </tr>`;
    }
    html += '</table></div>';
  }

  container.innerHTML = html || '<div style="color:var(--text-faint);font-size:.8rem;padding:20px">No fields match your filter.</div>';
}

// ── Authorship Panel ──────────────────────────────────────────────────────────
function renderAuthorship() {
  const authorFields = [
    ['Creator / Author',  ['xmp.Creator', 'iptc.Byline', 'exif.Artist', 'tiff.Artist']],
    ['Copyright',         ['xmp.Rights', 'iptc.CopyrightNotice', 'exif.Copyright', 'tiff.Copyright']],
    ['Camera Make',       ['exif.Make', 'tiff.Make']],
    ['Camera Model',      ['exif.Model', 'tiff.Model']],
    ['Software',          ['exif.Software', 'tiff.Software', 'xmp.CreatorTool']],
    ['Date Original',     ['exif.DateTimeOriginal', 'xmp.DateTimeOriginal', 'iptc.DateCreated']],
    ['Date Digitized',    ['exif.DateTimeDigitized', 'xmp.CreateDate']],
    ['Date Modified',     ['exif.DateTime', 'tiff.DateTime', 'xmp.ModifyDate']],
    ['Description',       ['iptc.Caption', 'xmp.Description', 'exif.ImageDescription', 'tiff.ImageDescription']],
    ['Keywords',          ['iptc.Keywords', 'xmp.Subject']],
    ['City',              ['iptc.City', 'xmp.City']],
    ['Country',           ['iptc.Country', 'xmp.Country']],
    ['Credit Line',       ['iptc.Credit', 'xmp.Credit']],
    ['Source',            ['iptc.Source', 'xmp.Source']],
    ['Headline',          ['iptc.Headline', 'xmp.Headline']],
    ['Instructions',      ['iptc.SpecialInstructions']],
    ['Job Identifier',    ['iptc.JobID', 'xmp.JobRef']],
    ['Serial Number',     ['exif.BodySerialNumber', 'exif.LensSerialNumber']],
    ['Unique ID',         ['xmp.DocumentID', 'xmp.InstanceID', 'xmp.OriginalDocumentID']],
    ['Lens',              ['exif.LensModel', 'exif.LensInfo']],
    ['Exposure',          ['exif.ExposureTime', 'exif.FNumber', 'exif.ISOSpeedRatings']],
    ['Focal Length',      ['exif.FocalLength', 'exif.FocalLengthIn35mmFilm']],
  ];

  function resolve(paths) {
    for (const p of paths) {
      const parts = p.split('.');
      let cur = allMeta;
      let found = true;
      for (const part of parts) {
        if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
        else { found = false; break; }
      }
      if (found && cur !== undefined && cur !== null) return cur;
    }
    return null;
  }

  let html = '<div class="meta-group"><div class="group-header"><div class="group-dot"></div><span class="group-title">AUTHORSHIP & PROVENANCE</span></div><table class="meta-table">';
  let found = 0;

  for (const [label, paths] of authorFields) {
    const val = resolve(paths);
    if (val !== null) {
      found++;
      const isDate  = val instanceof Date;
      const isArr   = Array.isArray(val);
      const display = isArr ? val.join(', ') : fmt(val);
      html += `<tr>
        <td class="meta-key">${label}</td>
        <td><span class="meta-val ${isDate ? 'highlighted' : ''}">${display}</span></td>
      </tr>`;
    }
  }

  if (!found) {
    html += `<tr><td colspan="2" style="color:var(--text-faint);font-size:.78rem;padding:16px 10px;">No authorship metadata found. The image may have been stripped.</td></tr>`;
  }

  html += '</table></div>';
  document.getElementById('authorshipContent').innerHTML = html;
}

// ── Location Panel ────────────────────────────────────────────────────────────
function renderLocation() {
  const gps = allMeta.gps || {};
  const lat  = gps._latitude  ?? gps.GPSLatitude  ?? null;
  const lon  = gps._longitude ?? gps.GPSLongitude ?? null;

  let html = '';

  if (lat != null && lon != null) {
    html += `<div class="coord-display">
      <div class="coord-chip"><div class="coord-label">LATITUDE</div><div class="coord-num">${lat.toFixed(6)}°</div></div>
      <div class="coord-chip"><div class="coord-label">LONGITUDE</div><div class="coord-num">${lon.toFixed(6)}°</div></div>
      <div class="coord-chip"><div class="coord-label">DECIMAL</div><div class="coord-num">${lat.toFixed(5)}, ${lon.toFixed(5)}</div></div>
    </div>`;

    const zoom = 14;
    html += `<div class="map-wrap" style="height:380px;margin-bottom:20px;">
      <iframe
        width="100%" height="100%"
        frameborder="0" scrolling="no"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.02},${lat - 0.02},${lon + 0.02},${lat + 0.02}&layer=mapnik&marker=${lat},${lon}"
        style="border:none;display:block;">
      </iframe>
    </div>
    <div style="margin-bottom:16px">
      <a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" class="btn" style="display:inline-block;width:auto;margin-right:8px">Open in Google Maps ↗</a>
      <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=${zoom}" target="_blank" class="btn" style="display:inline-block;width:auto">Open in OpenStreetMap ↗</a>
    </div>`;

    html += `<div class="meta-group"><div class="group-header"><div class="group-dot" style="background:var(--amber)"></div><span class="group-title">ALL GPS FIELDS</span></div><table class="meta-table">`;
    for (const [k, v] of Object.entries(gps)) {
      if (k.startsWith('_')) continue;
      html += `<tr><td class="meta-key">${escHtml(k)}</td><td><span class="meta-val">${fmt(v)}</span></td></tr>`;
    }
    html += '</table></div>';

  } else {
    html = `<div style="color:var(--text-faint);font-size:.82rem;padding:16px 0;line-height:1.7">
      <strong style="color:var(--text-dim)">No GPS data found.</strong><br>
      This image has no embedded location coordinates. This could mean the photo was taken with location services disabled, GPS was stripped during editing, or the file format doesn't support GPS (e.g. PNG typically doesn't carry GPS EXIF).
    </div>`;
  }

  document.getElementById('locationContent').innerHTML = html;
}

// ── Steg / Anomaly Panel ──────────────────────────────────────────────────────
async function renderSteg(file, imgEl) {
  const container = document.getElementById('stegContent');
  container.innerHTML = '<div style="color:var(--text-faint);font-size:.78rem;padding:12px 0">Analysing…</div>';

  await new Promise(r => setTimeout(r, 50));
  await new Promise(r => { if (imgEl.complete) r(); else imgEl.onload = r; });

  const W = imgEl.naturalWidth, H = imgEl.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.min(W, 512); canvas.height = Math.min(H, 512);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;

  // LSB bit balance
  const lsbCounts = [0, 0];
  for (let i = 0; i < px.length; i += 4) lsbCounts[px[i] & 1]++;
  const lsbRatio = lsbCounts[1] / (lsbCounts[0] + lsbCounts[1]);
  const lsbSuspect = Math.abs(lsbRatio - 0.5) < 0.01;

  // Chi-square test
  function chiSquareLSB(channel) {
    const freq = new Array(256).fill(0);
    for (let i = channel; i < px.length; i += 4) freq[px[i]]++;
    let chi = 0;
    for (let v = 0; v < 255; v += 2) {
      const obs0 = freq[v], obs1 = freq[v + 1];
      const exp = (obs0 + obs1) / 2;
      if (exp > 0) chi += Math.pow(obs0 - exp, 2) / exp + Math.pow(obs1 - exp, 2) / exp;
    }
    return chi;
  }
  const chiAvg = (chiSquareLSB(0) + chiSquareLSB(1) + chiSquareLSB(2)) / 3;
  const chiSuspect = chiAvg < 80;

  // Other checks
  const metaFields   = flatMeta.length;
  const unusualMeta  = metaFields > 200;
  const expectedBytes = W * H * 3;
  const sizeRatio    = file.size / expectedBytes;
  const sizeAnomaly  = sizeRatio > 1.4;
  const comments     = flatMeta.filter(r =>
    r.key.toLowerCase().includes('comment') ||
    r.key.toLowerCase().includes('usercomment') ||
    r.key.toLowerCase().includes('description')
  );

  // LSB visualisation canvas
  const lsbCanvas = document.createElement('canvas');
  lsbCanvas.width = canvas.width; lsbCanvas.height = canvas.height;
  lsbCanvas.className = 'canvas-steg';
  const lctx = lsbCanvas.getContext('2d');
  const lsbData = lctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < px.length; i += 4) {
    lsbData.data[i]     = (px[i]     & 1) * 255;
    lsbData.data[i + 1] = (px[i + 1] & 1) * 255;
    lsbData.data[i + 2] = (px[i + 2] & 1) * 255;
    lsbData.data[i + 3] = 255;
  }
  lctx.putImageData(lsbData, 0, 0);

  // Score & render
  const flags     = [lsbSuspect, chiSuspect, unusualMeta, sizeAnomaly].filter(Boolean).length;
  const riskLevel = flags === 0 ? 'Low' : flags === 1 ? 'Medium' : 'High';
  const riskColor = flags === 0 ? 'var(--green)' : flags === 1 ? 'var(--amber)' : 'var(--red)';

  let html = `<div class="steg-grid">
    <div class="steg-card ${flags >= 2 ? 'alert' : flags === 0 ? 'ok' : ''}">
      <div class="steg-card-title">Overall Risk</div>
      <div class="steg-result" style="color:${riskColor};font-size:1.1rem;font-weight:500">${riskLevel}</div>
      <div class="steg-note">${flags} indicator${flags !== 1 ? 's' : ''} flagged. This is a heuristic, not a guarantee.</div>
    </div>
    <div class="steg-card ${chiSuspect ? 'alert' : 'ok'}">
      <div class="steg-card-title">Chi-Square Test (LSB Pairs)</div>
      <div class="steg-result" style="color:${chiSuspect ? 'var(--amber)' : 'var(--green)'}">
        χ² = ${chiAvg.toFixed(1)} — ${chiSuspect ? 'Suspicious ⚠' : 'Normal ✓'}
      </div>
      <div class="steg-note">Low χ² near 0 indicates artificially balanced bit-pair frequencies, a classic LSB embedding signature.</div>
    </div>
    <div class="steg-card ${lsbSuspect ? 'alert' : 'ok'}">
      <div class="steg-card-title">LSB Bit Balance (R channel)</div>
      <div class="steg-result" style="color:${lsbSuspect ? 'var(--amber)' : 'var(--green)'}">
        ${(lsbRatio * 100).toFixed(2)}% ones — ${lsbSuspect ? 'Suspicious ⚠' : 'Normal ✓'}
      </div>
      <div class="steg-note">Near-perfect 50/50 ratio of 0/1 bits can indicate pseudo-random data hidden in LSBs.</div>
    </div>
    <div class="steg-card ${sizeAnomaly ? 'alert' : 'ok'}">
      <div class="steg-card-title">File Size Ratio</div>
      <div class="steg-result" style="color:${sizeAnomaly ? 'var(--amber)' : 'var(--green)'}">
        ${(sizeRatio * 100).toFixed(0)}% of raw — ${sizeAnomaly ? 'Elevated ⚠' : 'Normal ✓'}
      </div>
      <div class="steg-note">File is ${fmtFileSize(file.size)} vs ~${fmtFileSize(expectedBytes)} uncompressed. Unusually high for compressed format may indicate appended data.</div>
    </div>
    <div class="steg-card ${unusualMeta ? 'alert' : 'ok'}">
      <div class="steg-card-title">Metadata Volume</div>
      <div class="steg-result" style="color:${unusualMeta ? 'var(--amber)' : 'var(--green)'}">
        ${metaFields} fields — ${unusualMeta ? 'Elevated ⚠' : 'Normal ✓'}
      </div>
      <div class="steg-note">Unusually large metadata blocks can conceal payloads or indicate repeated re-saving.</div>
    </div>
    <div class="steg-card ${comments.length > 0 ? 'info' : 'ok'}">
      <div class="steg-card-title">Comment / Description Fields</div>
      <div class="steg-result" style="color:${comments.length > 0 ? 'var(--purple)' : 'var(--text-dim)'}">
        ${comments.length} found ${comments.length > 0 ? '— review below' : ''}
      </div>
      <div class="steg-note">Comment and description fields are a common carrier for hidden text messages.</div>
    </div>
  </div>`;

  if (comments.length > 0) {
    html += `<div class="meta-group" style="margin-bottom:20px">
      <div class="group-header"><div class="group-dot" style="background:var(--purple)"></div><span class="group-title">COMMENT & TEXT FIELDS</span></div>
      <table class="meta-table">`;
    for (const { key, val } of comments) {
      html += `<tr><td class="meta-key">${escHtml(key)}</td><td><span class="meta-val">${fmt(val)}</span></td></tr>`;
    }
    html += '</table></div>';
  }

  html += `<div class="meta-group">
    <div class="group-header">
      <div class="group-dot" style="background:var(--blue)"></div>
      <span class="group-title">LSB VISUALISATION</span>
      <span class="group-count">Bit-plane map of R·G·B channels</span>
    </div>
    <p style="font-size:.75rem;color:var(--text-faint);margin-bottom:12px;line-height:1.6">
      Each pixel shows the least-significant bit of its R, G, B channels amplified to 0 or 255.
      A uniformly random-looking pattern (salt-and-pepper noise) is normal.
      Visible structures, text, or suspiciously uniform regions may indicate steganographic content.
    </p>
  </div>`;

  container.innerHTML = html;
  container.querySelector('.meta-group:last-child').appendChild(lsbCanvas);
}

// ── Raw JSON ──────────────────────────────────────────────────────────────────
function renderRaw() {
  function syntaxHL(json) {
    return json
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
        let cls = 'json-number';
        if (/^"/.test(m))       cls = /:$/.test(m) ? 'json-key' : 'json-string';
        else if (/true|false/.test(m)) cls = 'json-bool';
        else if (/null/.test(m))       cls = 'json-null';
        return `<span class="${cls}">${m}</span>`;
      });
  }

  function sanitiseForJson(obj) {
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
      const arr = obj instanceof ArrayBuffer ? new Uint8Array(obj) : obj;
      return `[Binary: ${arr.length} bytes]`;
    }
    if (Array.isArray(obj)) return obj.map(sanitiseForJson);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = sanitiseForJson(v);
      return out;
    }
    return obj;
  }

  const json = JSON.stringify(sanitiseForJson(allMeta), null, 2);
  document.getElementById('rawJson').innerHTML = syntaxHL(json);
}

// ── Forensics sidebar ─────────────────────────────────────────────────────────
function renderForensics() {
  const exif = allMeta.exif || allMeta.tiff || {};
  const xmp  = allMeta.xmp  || {};
  const gps  = allMeta.gps  || {};

  const make     = exif.Make    || exif.make    || null;
  const model    = exif.Model   || exif.model   || null;
  const software = exif.Software || xmp.CreatorTool || null;
  const dateOrig = exif.DateTimeOriginal || xmp.DateTimeOriginal || null;
  const hasGPS   = gps._latitude  != null || gps.GPSLatitude  != null;
  const hasThumb = exif.ThumbnailOffset != null || exif.JPEGInterchangeFormat != null;

  const cards = [
    { label: 'Camera',          value: make && model ? `${make} ${model}` : make || model || 'Unknown', cls: make ? 'ok' : '' },
    { label: 'Software',        value: software || 'Not set',                                            cls: software ? 'info' : '' },
    { label: 'Date Captured',   value: dateOrig ? (dateOrig instanceof Date ? dateOrig.toLocaleDateString() : String(dateOrig).slice(0, 10)) : 'Not found', cls: dateOrig ? 'ok' : '' },
    { label: 'GPS Embedded',    value: hasGPS   ? '✓ Yes' : '✗ No',                                     cls: hasGPS ? 'ok' : '' },
    { label: 'Thumbnail',       value: hasThumb ? 'Present' : 'None',                                    cls: '' },
    { label: 'Metadata Groups', value: Object.keys(allMeta).join(', ').toUpperCase() || 'None',          cls: 'info' },
  ];

  document.getElementById('forensicsGrid').innerHTML = cards.map(c => `
    <div class="foren-card ${c.cls}">
      <div class="foren-label">${c.label}</div>
      <div class="foren-value ${c.cls === 'ok' ? 'good' : c.cls === 'info' ? 'purple' : ''}">${escHtml(String(c.value))}</div>
    </div>`).join('');
}

// ── Group Filter ──────────────────────────────────────────────────────────────
function renderGroupFilter() {
  const sel = document.getElementById('groupFilter');
  sel.innerHTML = '<option value="">All groups</option>';
  for (const g of Object.keys(allMeta)) {
    if (allMeta[g] && typeof allMeta[g] === 'object') {
      sel.innerHTML += `<option value="${g}">${g.toUpperCase()}</option>`;
    }
  }
}

// ── Global helper (called from inline onclick in rendered HTML) ───────────────
window.openMap = () => {
  const lat = allMeta.gps?._latitude  ?? allMeta.gps?.GPSLatitude;
  const lon = allMeta.gps?._longitude ?? allMeta.gps?.GPSLongitude;
  if (lat && lon) document.querySelector('[data-tab="location"]').click();
};

// ── Events ────────────────────────────────────────────────────────────────────
function handleFile(f) { if (f) loadFile(f); }

document.getElementById('fileInput').addEventListener('change', e => handleFile(e.target.files[0]));

const dz = document.getElementById('dropZone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
dz.addEventListener('drop',      e  => { e.preventDefault(); dz.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('searchInput').addEventListener('input', e => {
  renderStructured(e.target.value.toLowerCase(), document.getElementById('groupFilter').value);
});
document.getElementById('groupFilter').addEventListener('change', e => {
  renderStructured(document.getElementById('searchInput').value.toLowerCase(), e.target.value);
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  function sanitise(obj) {
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
      const a = obj instanceof ArrayBuffer ? new Uint8Array(obj) : obj;
      return `[Binary: ${a.length} bytes]`;
    }
    if (Array.isArray(obj)) return obj.map(sanitise);
    if (obj && typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = sanitise(v); return o; }
    return obj;
  }
  const blob = new Blob([JSON.stringify(sanitise(allMeta), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFile?.name || 'metadata') + '_metadata.json';
  a.click();
});

document.getElementById('exportTxtBtn').addEventListener('click', () => {
  let txt = `Metadata Report\n${'='.repeat(60)}\nFile: ${currentFile?.name}\nDate: ${new Date().toISOString()}\n\n`;
  for (const { key, val } of flatMeta) {
    txt += `${key.padEnd(40)} ${val instanceof Date ? val.toISOString() : String(val)}\n`;
  }
  const blob = new Blob([txt], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFile?.name || 'metadata') + '_metadata.txt';
  a.click();
});

document.getElementById('loadNewBtn').addEventListener('click', () => {
  document.getElementById('previewWrap').classList.remove('visible');
  document.getElementById('dropZone').style.display = '';
  document.getElementById('mainUI').style.display = 'none';
  document.getElementById('emptyState').style.display = '';
  document.getElementById('actionsPanel').style.display = 'none';
  document.getElementById('forensicsPanel').style.display = 'none';
  document.getElementById('fileInput').value = '';
  allMeta = {}; flatMeta = []; currentFile = null;
});