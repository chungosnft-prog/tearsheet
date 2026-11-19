import { Engine } from './engine.js';
import { EFFECTS, GALLERY, ITEMS, BLENDS, defaultsFor } from './effects.js';
import { RECIPES } from './recipes.js';
import { makeSample } from './sample.js';
import { MaskStore } from './masks.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const STORE = 'tearsheet.v1';
const THUMB_W = 300, THUMB_H = 225, THUMB_PX = 0.55;

const canvas = $('#gl');
let engine;
try { engine = new Engine(canvas); } catch (e) { showNoWebGL(); throw e; }

// iOS/iPadOS 14 ships WebGL 2 switched off; everything here runs on it.
function showNoWebGL() {
  const probe = document.createElement('canvas');
  const hasGL1 = !!(probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  const apple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS|Edg/.test(navigator.userAgent);
  const steps = apple
    ? `<ol>
        <li>Open <b>Settings → Safari → Advanced → Experimental Features</b></li>
        <li>Turn on <b>WebGL 2.0</b></li>
        <li>Come back here and reload the page</li>
      </ol>
      <p class="alt">Or update to iPadOS / iOS 15 or later, where it’s already on.</p>`
    : `<p>Try the latest Chrome, Safari, Edge or Firefox, and make sure hardware acceleration is switched on.</p>`;
  document.body.innerHTML = `
    <div class="nogl">
      <span class="logo" aria-hidden="true"></span>
      <h1>Tearsheet needs WebGL 2</h1>
      <p>${hasGL1 ? 'This browser has WebGL 2 turned off, and every filter here runs on it.' : 'This browser can’t run WebGL, which every filter here needs.'}</p>
      ${steps}
    </div>`;
}

const masks = new MaskStore(engine);

// ---------------------------------------------------------------- state
let state = { layers: [], sel: null, docLong: 2000 };
const view = { zoom: 1, x: 0, y: 0, compare: 'after', split: 0.5, peek: false };
let original = null;          // full-res source (canvas or ImageBitmap)
let doc = null;               // { w, h }
const docCanvas = document.createElement('canvas');
const thumbCanvas = document.createElement('canvas');
document.getElementById('refWrap').prepend(docCanvas); // the untouched original, shown in Stack view
const REF_GAP = 18; // px between the edit and the original in Stack view (matches #refWrap margin)
thumbCanvas.width = THUMB_W; thumbCanvas.height = THUMB_H;
let uid = 1;
const brush = { active: false, mode: 0, size: 180, hardness: 0, exposure: 0.5, show: false };
try { Object.assign(brush, JSON.parse(localStorage.getItem('tearsheet.brush')) || {}, { active: false }); } catch {}
const saveBrush = () => { try { const { active, ...b } = brush; localStorage.setItem('tearsheet.brush', JSON.stringify(b)); } catch {} };
let spaceDown = false;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.layers)) {
      s.layers = s.layers.filter((l) => ITEMS[l.item] && EFFECTS[l.effect]);
      s.layers.forEach((l) => { l.id = uid++; l.params = { ...defaultsFor(l.item), ...l.params }; });
      s.sel = s.layers.length ? s.layers[s.layers.length - 1].id : null;
      return s;
    }
  } catch {}
  return null;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ docLong: state.docLong, layers: state.layers })); } catch {}
  masks.prune(new Set(state.layers.filter((l) => l.mask).map((l) => l.mask.id)));
}

// ---------------------------------------------------------------- history
const hist = { stack: [], i: -1 };
const snap = () => JSON.stringify({ layers: state.layers, sel: state.sel });
function commit() {
  const s = snap();
  if (hist.stack[hist.i] === s) return;
  hist.stack = hist.stack.slice(0, hist.i + 1);
  hist.stack.push(s);
  if (hist.stack.length > 120) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  save();
  updateUndo();
}
function restore(i) {
  hist.i = i;
  const s = JSON.parse(hist.stack[i]);
  state.layers = s.layers; state.sel = s.sel;
  for (const L of state.layers) {
    const m = L.mask && masks.get(L.mask.id);
    if (!m) continue;
    if (m.cur !== L.mask.ver) masks.seek(m, L.mask.ver);
    queueMaskSave(m);
  }
  save(); updateUndo(); refreshAll();
}
const undo = () => hist.i > 0 && restore(hist.i - 1);
const redo = () => hist.i < hist.stack.length - 1 && restore(hist.i + 1);
function updateUndo() {
  $('#undoBtn').disabled = hist.i <= 0;
  $('#redoBtn').disabled = hist.i >= hist.stack.length - 1;
}

// ---------------------------------------------------------------- layers
const selLayer = () => state.layers.find((l) => l.id === state.sel);
const isDB = (L) => !!L && L.effect === 'dodgeburn';
const aspect = () => (doc ? doc.w / doc.h : 2000 / 1400);
// every Dodge & Burn layer owns a painted map in the mask store
function ensureMask(L) {
  if (!isDB(L)) return null;
  if (!L.mask) L.mask = { id: masks.create(aspect()).id, ver: 0 };
  return masks.get(L.mask.id) || masks.create(aspect(), L.mask.id);
}
function makeLayer(itemId, overrides = {}, extra = {}) {
  const it = ITEMS[itemId];
  const L = { id: uid++, item: itemId, effect: it.effect, params: defaultsFor(itemId, overrides), visible: true, opacity: 1, blend: 0, ...extra };
  ensureMask(L);
  return L;
}
function addLayer(itemId) {
  const L = makeLayer(itemId);
  const i = state.layers.findIndex((l) => l.id === state.sel);
  // dodge & burn shapes tone, so by default it sits under every screen
  if (isDB(L)) state.layers.unshift(L);
  else state.layers.splice(i < 0 ? state.layers.length : i + 1, 0, L);
  state.sel = L.id;
  commit();
  if (isDB(L)) { brush.active = true; toast('Dodge & Burn added at the bottom of the stack — paint on the image'); }
  else toast(`Added ${ITEMS[itemId].label}`);
  refreshAll();
}
function applyItem(itemId, asNew) {
  const L = selLayer();
  if (asNew || !L) return addLayer(itemId);
  const it = ITEMS[itemId];
  L.item = itemId; L.effect = it.effect; L.params = defaultsFor(itemId);
  ensureMask(L);
  if (isDB(L)) brush.active = true;
  commit(); refreshAll();
}
function applyRecipe(r) {
  state.layers = r.layers.map(([item, ov, extra]) => makeLayer(item, ov, extra));
  state.sel = state.layers.length ? state.layers[state.layers.length - 1].id : null;
  commit(); refreshAll();
  toast(`Recipe: ${r.name}`);
}

// ---------------------------------------------------------------- rendering
const resolved = () => state.layers.filter((l) => l.visible).map((l) => ({ ...l, def: EFFECTS[l.effect], maskTex: l.mask ? masks.get(l.mask.id)?.tex : null }));
let raf = 0;
function requestRender() {
  if (raf || !doc) return;
  raf = requestAnimationFrame(() => { raf = 0; renderNow(); });
}
function splitX() {
  if (view.peek || view.compare === 'before') return doc.w + 1;
  if (view.compare === 'split') return view.split * doc.w;
  return -1;
}
function overlayTex() {
  const L = selLayer();
  return brush.show && isDB(L) && L.mask ? masks.get(L.mask.id)?.tex : null;
}
function renderNow() {
  masks.flushAll();
  const out = engine.run('doc', resolved(), 1);
  engine.present(out, 'doc', splitX(), overlayTex());
  hud();
}
function hud() {
  if (!doc) return;
  const errs = [...engine.errors.keys()];
  const n = state.layers.length;
  $('#hud').textContent = `${doc.w}×${doc.h} px  ·  ${n} layer${n === 1 ? '' : 's'}` + (errs.length ? `  ·  ⚠ ${errs.join(', ')} failed` : '');
}

// ---------------------------------------------------------------- document
function buildDoc() {
  if (!original) return;
  const iw = original.width, ih = original.height;
  const lim = srcLimits();
  let long = state.docLong === 'native' ? Math.max(iw, ih) : +state.docLong;
  long = Math.min(long, engine.maxTex, lim.side);
  let s = long / Math.max(iw, ih);
  if (iw * ih * s * s > lim.area) s = Math.sqrt(lim.area / (iw * ih));
  const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
  docCanvas.width = w; docCanvas.height = h;
  const g = docCanvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, w, h);
  g.drawImage(original, 0, 0, w, h);
  doc = { w, h };
  engine.setSource('doc', docCanvas);

  const tg = thumbCanvas.getContext('2d');
  tg.imageSmoothingQuality = 'high';
  tg.clearRect(0, 0, THUMB_W, THUMB_H);
  const cs = Math.max(THUMB_W / w, THUMB_H / h);
  tg.drawImage(docCanvas, (THUMB_W - w * cs) / 2, (THUMB_H - h * cs) / 2, w * cs, h * cs);
  engine.setSource('thumb', thumbCanvas);

  fit();
  renderNow();
  scheduleThumbs();
}
// iPad/iPhone Safari silently renders canvases over ~16.7 MP blank, so touch
// devices get a tighter cap on both the kept source and the working document.
function srcLimits() {
  const touch = navigator.maxTouchPoints > 1 || /iPad|iPhone|iPod/.test(navigator.userAgent);
  return touch ? { side: 4096, area: 16e6 } : { side: 8192, area: 64e6 };
}
const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i;

// Try every decoder the browser might have; Safari, Chrome and Firefox each
// fail on different ones (HEIC, EXIF orientation options, missing MIME types).
async function decodeImage(file) {
  const attempts = [
    ['image element', () => new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image element could not decode it')); };
      img.src = url;
    })],
    ['bitmap (EXIF)', () => createImageBitmap(file, { imageOrientation: 'from-image' })],
    ['bitmap', () => createImageBitmap(file)],
  ];
  const errs = [];
  for (const [name, fn] of attempts) {
    try {
      const im = await fn();
      if (im.width && im.height) return im;
      errs.push(name + ': empty');
    } catch (e) { errs.push(`${name}: ${e.message || e}`); }
  }
  throw new Error(errs.join(' · '));
}

// copy into a canvas no bigger than the device can handle, then drop the decode
function normalise(im) {
  const lim = srcLimits();
  let s = Math.min(1, lim.side / Math.max(im.width, im.height));
  if (im.width * im.height * s * s > lim.area) s = Math.sqrt(lim.area / (im.width * im.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.width * s));
  c.height = Math.max(1, Math.round(im.height * s));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, c.width, c.height);
  if (im.close) im.close();
  return c;
}

async function loadFile(file) {
  if (!file) return;
  const looksLikeImage = !file.type || file.type.startsWith('image/') || IMG_EXT.test(file.name || '');
  if (!looksLikeImage) return toast('That isn’t an image');
  toast(`Opening ${file.name || 'image'}…`);
  try {
    const im = await decodeImage(file);
    const w = im.width, h = im.height;
    original = normalise(im);
    buildDoc();
    const shrunk = original.width !== w ? ` → kept at ${original.width}×${original.height}` : '';
    toast(`Opened ${file.name || 'image'} (${w}×${h}${shrunk})`);
  } catch (e) {
    console.error('Could not open image:', e);
    const heic = /\.(heic|heif)$/i.test(file.name || '') || /hei[cf]/.test(file.type);
    toast(heic ? 'This browser can’t read HEIC — try Safari, or export the photo as JPEG' : `Could not open that image (${e.message})`, 6000);
  }
}
function loadSample() { original = makeSample(); buildDoc(); }

// ---------------------------------------------------------------- viewport
const vp = $('#viewport'), stage = $('#stage'), splitLine = $('#splitLine');
function applyView() {
  if (!doc) return;
  canvas.style.width = doc.w * view.zoom + 'px';
  canvas.style.height = doc.h * view.zoom + 'px';
  canvas.classList.toggle('pix', view.zoom >= 2);
  docCanvas.style.width = canvas.style.width;
  docCanvas.style.height = canvas.style.height;
  docCanvas.classList.toggle('pix', view.zoom >= 2);
  vp.classList.toggle('stack', view.compare === 'stack');
  stage.style.transform = `translate(${view.x}px, ${view.y}px)`;
  $('#zoomBtn').textContent = Math.round(view.zoom * 100) + '%';
  const showSplit = view.compare === 'split' && !view.peek;
  splitLine.style.display = showSplit ? 'block' : 'none';
  if (showSplit) splitLine.style.left = view.x + view.split * doc.w * view.zoom + 'px';
}
function fit() {
  if (!doc) return;
  const r = vp.getBoundingClientRect();
  const pad = 36;
  const stack = view.compare === 'stack';
  const gap = stack ? REF_GAP : 0, rows = stack ? 2 : 1;
  view.zoom = Math.min((r.width - pad * 2) / doc.w, (r.height - pad * 2 - gap) / (doc.h * rows), 4);
  view.x = (r.width - doc.w * view.zoom) / 2;
  view.y = (r.height - doc.h * view.zoom * rows - gap) / 2;
  applyView();
}
function zoomAt(z, mx, my) {
  z = Math.min(Math.max(z, 0.05), 16);
  view.x = mx - (mx - view.x) * (z / view.zoom);
  view.y = my - (my - view.y) * (z / view.zoom);
  view.zoom = z;
  applyView();
}
vp.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  const k = e.ctrlKey ? 0.012 : 0.0016;
  zoomAt(view.zoom * Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
  moveRing(e);
}, { passive: false });
let drag = null;
vp.addEventListener('contextmenu', (e) => e.preventDefault());
vp.addEventListener('pointerdown', (e) => {
  if (drag) return; // a resting palm or second finger mustn't hijack a stroke
  if (e.target.closest('#splitLine span')) {
    drag = { split: true };
  } else if (brush.active && e.button === 0 && !spaceDown && doc) {
    startStroke(e);
  } else {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    vp.classList.add('panning');
  }
  if (drag) drag.pointer = e.pointerId;
  vp.setPointerCapture(e.pointerId);
});
vp.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId !== drag.pointer) return;
  moveRing(e);
  if (!drag) return;
  if (drag.paint) {
    paintTo(e);
  } else if (drag.split) {
    const r = vp.getBoundingClientRect();
    view.split = Math.min(Math.max((e.clientX - r.left - view.x) / (doc.w * view.zoom), 0), 1);
    applyView(); requestRender();
  } else {
    view.x = drag.vx + e.clientX - drag.x;
    view.y = drag.vy + e.clientY - drag.y;
    applyView();
  }
});
const endDrag = (e) => {
  if (!drag || (drag.pointer !== undefined && e && e.pointerId !== drag.pointer)) return;
  if (drag.paint) endStroke();
  drag = null;
  vp.classList.remove('panning');
};
vp.addEventListener('pointerleave', () => { ring.style.display = 'none'; });
vp.addEventListener('pointerup', endDrag);
vp.addEventListener('pointercancel', endDrag);
vp.addEventListener('dblclick', () => { if (!brush.active) fit(); });
new ResizeObserver(() => doc && fit()).observe(vp);

// ---------------------------------------------------------------- dodge & burn brush
const ring = $('#brushRing');
let lastPointer = null;
function docPoint(e) {
  const r = vp.getBoundingClientRect();
  return [(e.clientX - r.left - view.x) / view.zoom, (e.clientY - r.top - view.y) / view.zoom];
}
const brushMode = (alt) => (brush.mode === 2 ? 2 : alt ? 1 - brush.mode : brush.mode);
function moveRing(e) {
  if (e) lastPointer = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
  const p = lastPointer;
  if (!brush.active || !p || spaceDown || (drag && !drag.paint)) { ring.style.display = 'none'; return; }
  const r = vp.getBoundingClientRect();
  const d = Math.max(brush.size * view.zoom, 4);
  Object.assign(ring.style, { display: 'block', left: p.clientX - r.left + 'px', top: p.clientY - r.top + 'px', width: d + 'px', height: d + 'px' });
  ring.style.setProperty('--h', Math.max(brush.hardness, 0.04) * 100 + '%');
  ring.dataset.mode = ['dodge', 'burn', 'erase'][brushMode(p.altKey)];
}
function startStroke(e) {
  const L = selLayer();
  if (!isDB(L)) return;
  const m = ensureMask(L);
  masks.begin(m);
  drag = { paint: true, m, L, last: null, rem: 0 };
  paintTo(e);
}
function paintTo(e) {
  const { m } = drag;
  const sx = m.w / doc.w, sy = m.h / doc.h;
  const r = (brush.size / 2) * sx;
  const mode = brushMode(e.altKey);
  const amt = brush.exposure * (mode === 2 ? 0.3 : 0.12);
  const spacing = Math.max(0.75, r * 0.18);
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
  for (const ev of evs) {
    const [dx, dy] = docPoint(ev);
    const p = [dx * sx, dy * sy];
    if (!drag.last) { masks.dab(m, p[0], p[1], r, brush.hardness, amt, mode); drag.last = p; drag.rem = 0; continue; }
    const [lx, ly] = drag.last;
    const dist = Math.hypot(p[0] - lx, p[1] - ly);
    let t = spacing - drag.rem;
    while (t <= dist) {
      const k = t / dist;
      masks.dab(m, lx + (p[0] - lx) * k, ly + (p[1] - ly) * k, r, brush.hardness, amt, mode);
      t += spacing;
    }
    drag.rem = dist - (t - spacing);
    drag.last = p;
  }
  requestRender();
}
function endStroke() {
  const { m, L } = drag;
  if (masks.end(m)) {
    L.mask.ver = m.cur;
    commit();
    queueMaskSave(m);
  }
}
function clearStrokes() {
  const L = selLayer();
  const m = ensureMask(L);
  if (!m) return;
  masks.begin(m);
  masks.fill(m, 0);
  if (masks.end(m)) { L.mask.ver = m.cur; commit(); queueMaskSave(m); toast('Strokes cleared'); }
  requestRender();
}
const maskSaves = new Set();
let maskSaveT = 0;
function queueMaskSave(m) {
  maskSaves.add(m);
  clearTimeout(maskSaveT);
  maskSaveT = setTimeout(() => {
    maskSaves.forEach((mm) => masks.save(mm));
    maskSaves.clear();
    masks.prune(new Set(state.layers.filter((l) => l.mask).map((l) => l.mask.id)));
  }, 900);
}
function setTool(on) {
  if (on && !doc) return;
  if (on && !isDB(selLayer())) {
    const L = state.layers.find(isDB);
    if (L) state.sel = L.id;
    else return addLayer('dodgeburn');
  }
  brush.active = on;
  refreshAll();
}
function updateToolUI() {
  $('#brushBtn').classList.toggle('on', brush.active);
  vp.classList.toggle('brush', brush.active);
  moveRing();
}

// ---------------------------------------------------------------- gallery
const thumbEls = {};
function buildGallery() {
  const wrap = $('#thumbs'), cats = $('#cats');
  for (const g of GALLERY) {
    const sec = el('section', 'cat');
    sec.dataset.cat = g.cat;
    sec.append(el('div', 'cat-title', g.cat));
    const grid = el('div', 'grid');
    for (const [id, label] of g.items) {
      const b = el('button', 'thumb loading');
      b.dataset.id = id;
      b.title = `${label} — ${EFFECTS[ITEMS[id].effect].name}`;
      const c = el('canvas'); c.width = THUMB_W; c.height = THUMB_H;
      b.append(c, el('span', 'lbl', label), el('i', 'add', '+'));
      b.addEventListener('click', (e) => applyItem(id, e.shiftKey || e.altKey || !!e.target.closest('.add')));
      grid.append(b);
      thumbEls[id] = { b, c, label: label.toLowerCase(), cat: g.cat.toLowerCase() };
    }
    sec.append(grid);
    wrap.append(sec);
    const chip = el('button', null, g.cat);
    chip.addEventListener('click', () => { $('#search').value = ''; filterGallery(''); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    cats.append(chip);
  }
  $('#search').addEventListener('input', (e) => filterGallery(e.target.value));
}
function filterGallery(q) {
  q = q.trim().toLowerCase();
  for (const sec of document.querySelectorAll('.cat')) {
    let any = false;
    for (const b of sec.querySelectorAll('.thumb')) {
      const t = thumbEls[b.dataset.id];
      const hit = !q || t.label.includes(q) || t.cat.includes(q) || EFFECTS[ITEMS[b.dataset.id].effect].name.toLowerCase().includes(q);
      b.style.display = hit ? '' : 'none';
      any = any || hit;
    }
    sec.style.display = any ? '' : 'none';
  }
}
let thumbJob = 0;
function scheduleThumbs() {
  const job = ++thumbJob;
  const ids = Object.keys(thumbEls);
  ids.forEach((id) => thumbEls[id].b.classList.add('loading'));
  let i = 0;
  const step = () => {
    if (job !== thumbJob) return;
    const t0 = performance.now();
    while (i < ids.length && performance.now() - t0 < 12) {
      const id = ids[i++];
      const it = ITEMS[id];
      const out = engine.run('thumb', [{ effect: it.effect, def: EFFECTS[it.effect], params: defaultsFor(id), blend: 0, opacity: 1, demo: true }], THUMB_PX);
      const px = engine.read(out);
      thumbEls[id].c.getContext('2d').putImageData(new ImageData(px, THUMB_W, THUMB_H), 0, 0);
      thumbEls[id].b.classList.remove('loading');
    }
    if (i < ids.length) setTimeout(step, 0);
    else requestRender();
  };
  setTimeout(step, 30);
}
function markGallery() {
  const L = selLayer();
  for (const id in thumbEls) thumbEls[id].b.classList.toggle('on', !!L && L.item === id);
}

// ---------------------------------------------------------------- inspector
const fmt = (v, step) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (+v).toFixed(d);
};
function setFill(range) {
  const f = ((range.value - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty('--f', f + '%');
}
function rowWith(label, control, extra, wide) {
  const row = el('div', 'row' + (wide ? ' wide' : ''));
  const lab = el('label', null, label);
  row.append(lab, control);
  if (extra) row.append(extra);
  return { row, lab };
}
function rangeRow(label, value, min, max, step, unit, onInput, onCommit, reset) {
  const range = el('input');
  Object.assign(range, { type: 'range', min, max, step, value });
  const num = el('input', 'num');
  Object.assign(num, { type: 'number', min, max, step, value: fmt(value, step) });
  if (unit) num.title = unit;
  setFill(range);
  range.addEventListener('input', () => { num.value = fmt(range.value, step); setFill(range); onInput(+range.value); });
  range.addEventListener('change', onCommit);
  num.addEventListener('change', () => {
    const v = Math.min(Math.max(+num.value || 0, -1e6), 1e6);
    range.value = v; setFill(range); onInput(v); onCommit();
  });
  const { row, lab } = rowWith(label, range, num);
  lab.title = 'Double-click to reset';
  lab.addEventListener('dblclick', () => {
    const v = reset();
    range.value = v; num.value = fmt(v, step); setFill(range); onInput(v); onCommit();
  });
  return row;
}

function renderParams() {
  const box = $('#params');
  box.innerHTML = '';
  const L = selLayer();
  if (!L) {
    box.append(el('div', 'empty', '<b>No effect layers yet.</b><br>Pick a filter from the gallery<br>or load a recipe to start.'));
    return;
  }
  const def = EFFECTS[L.effect];
  const head = el('div', 'p-head');
  const titles = el('div');
  titles.append(el('h2', null, ITEMS[L.item].label), el('div', 'eff', def.name));
  const resetBtn = el('button', null, 'Reset');
  resetBtn.title = 'Reset all values to this filter’s defaults';
  resetBtn.addEventListener('click', () => { L.params = defaultsFor(L.item); commit(); renderParams(); requestRender(); });
  head.append(titles, resetBtn);
  box.append(head);
  if (isDB(L)) renderBrushPanel(box);

  // layer blending
  box.append(el('div', 'p-sec', 'Layer'));
  const bsel = el('select');
  BLENDS.forEach((b, i) => bsel.append(new Option(b, i)));
  bsel.value = L.blend;
  bsel.addEventListener('change', () => { L.blend = +bsel.value; commit(); renderLayers(); requestRender(); });
  box.append(rowWith('Blend', bsel, null, true).row);
  box.append(rangeRow('Opacity', L.opacity, 0, 1, 0.01, '', (v) => { L.opacity = v; requestRender(); }, () => { commit(); renderLayers(); }, () => 1));

  let chipRow = null;
  for (const p of def.params) {
    if (p.section) { box.append(el('div', 'p-sec', p.section)); chipRow = null; continue; }
    const set = (v) => { L.params[p.key] = v; requestRender(); };
    const val = L.params[p.key] ?? p.def;
    if (p.type === 'range') {
      box.append(rangeRow(p.label, val, p.min, p.max, p.step, p.unit, set, commit, () => p.def));
      chipRow = null;
    } else if (p.type === 'select') {
      let ctrl;
      if (p.options.length <= 3) {
        ctrl = el('div', 'segs');
        p.options.forEach((o, i) => {
          const b = el('button', i === val ? 'on' : '', o);
          b.addEventListener('click', () => { set(i); commit(); renderParams(); });
          ctrl.append(b);
        });
      } else {
        ctrl = el('select');
        p.options.forEach((o, i) => ctrl.append(new Option(o, i)));
        ctrl.value = val;
        ctrl.addEventListener('change', () => { set(+ctrl.value); commit(); });
      }
      box.append(rowWith(p.label, ctrl, null, true).row);
      chipRow = null;
    } else if (p.type === 'color') {
      const wrap = el('div', 'colorbox');
      const ci = el('input'); ci.type = 'color'; ci.value = val;
      const hx = el('input', 'num hex'); hx.value = val; hx.spellcheck = false;
      ci.addEventListener('input', () => { hx.value = ci.value; set(ci.value); });
      ci.addEventListener('change', commit);
      hx.addEventListener('change', () => {
        let v = hx.value.trim(); if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
        if (/^#[0-9a-f]{6}$/i.test(v)) { ci.value = v.toLowerCase(); hx.value = ci.value; set(ci.value); commit(); } else hx.value = ci.value;
      });
      wrap.append(ci, hx);
      const { row, lab } = rowWith(p.label, wrap, null, true);
      lab.title = 'Double-click to reset';
      lab.addEventListener('dblclick', () => { ci.value = hx.value = p.def; set(p.def); commit(); });
      box.append(row);
      chipRow = null;
    } else if (p.type === 'bool' && p.chip) {
      if (!chipRow) {
        chipRow = el('div', 'chips');
        box.append(rowWith('Edges', chipRow, null, true).row);
      }
      const b = el('button', val ? 'on' : '', p.label);
      b.addEventListener('click', () => { const v = !L.params[p.key]; b.classList.toggle('on', v); set(v); commit(); });
      chipRow.append(b);
    } else if (p.type === 'bool') {
      const t = el('button', 'toggle' + (val ? ' on' : ''));
      t.setAttribute('aria-pressed', !!val);
      t.addEventListener('click', () => { const v = !L.params[p.key]; t.classList.toggle('on', v); t.setAttribute('aria-pressed', v); set(v); commit(); });
      box.append(rowWith(p.label, t, null, true).row);
      chipRow = null;
    } else if (p.type === 'seed') {
      const wrap = el('div', 'seedbox');
      const n = el('input', 'num'); n.type = 'number'; n.value = val; n.step = 1;
      const dice = el('button', null, '⚄ Reroll');
      n.addEventListener('change', () => { set(Math.round(+n.value) || 0); commit(); });
      dice.addEventListener('click', () => { const v = 1 + Math.floor(Math.random() * 9999); n.value = v; set(v); commit(); });
      wrap.append(n, dice);
      box.append(el('div', 'p-sec', 'Randomness'));
      box.append(rowWith(p.label, wrap, null, true).row);
      chipRow = null;
    }
  }
}

function renderBrushPanel(box) {
  box.append(el('div', 'p-sec', 'Brush'));
  const tool = el('button', 'paint-btn' + (brush.active ? ' on' : ''), brush.active ? '◐ Painting — drag on the image' : '◐ Start painting');
  tool.title = 'Toggle the brush (O)';
  tool.addEventListener('click', () => setTool(!brush.active));
  box.append(tool);
  const segs = el('div', 'segs');
  ['Dodge', 'Burn', 'Erase'].forEach((name, i) => {
    const b = el('button', brush.mode === i ? 'on' : '', name);
    b.addEventListener('click', () => { brush.mode = i; saveBrush(); renderParams(); moveRing(); });
    segs.append(b);
  });
  box.append(rowWith('Mode', segs, null, true).row);
  const bset = (k) => (v) => { brush[k] = v; saveBrush(); moveRing(); };
  box.append(rangeRow('Size', brush.size, 4, 1500, 1, 'px', bset('size'), () => {}, () => 180));
  box.append(rangeRow('Hardness', brush.hardness, 0, 1, 0.01, '', bset('hardness'), () => {}, () => 0));
  box.append(rangeRow('Exposure', brush.exposure, 0.02, 1, 0.01, '', bset('exposure'), () => {}, () => 0.5));
  const show = el('button', 'toggle' + (brush.show ? ' on' : ''));
  show.addEventListener('click', () => { brush.show = !brush.show; show.classList.toggle('on', brush.show); saveBrush(); requestRender(); });
  box.append(rowWith('Show strokes', show, null, true).row);
  const clr = el('button', null, 'Clear strokes');
  clr.addEventListener('click', clearStrokes);
  box.append(rowWith('', clr, null, true).row);
  box.append(el('p', 'hint', '<kbd>Alt</kbd> flips dodge ↔ burn · <kbd>X</kbd> swaps · <kbd>[</kbd> <kbd>]</kbd> size · <kbd>⇧</kbd><kbd>[</kbd> <kbd>]</kbd> hardness · hold <kbd>Space</kbd> or right-drag to pan'));
}

// ---------------------------------------------------------------- layer list
let dragId = null;
function renderLayers() {
  const ul = $('#layerList');
  ul.innerHTML = '';
  if (!state.layers.length) {
    ul.append(el('li', 'empty', 'Empty stack'));
  }
  // top of the list is the last-applied (top-most) layer, like Photoshop
  for (const L of [...state.layers].reverse()) {
    const li = el('li', 'layer' + (L.id === state.sel ? ' sel' : '') + (L.visible ? '' : ' off'));
    li.draggable = true;
    li.dataset.id = L.id;
    const eye = el('button', 'eye', L.visible ? '◉' : '○');
    eye.title = L.visible ? 'Hide' : 'Show';
    eye.addEventListener('click', (e) => { e.stopPropagation(); L.visible = !L.visible; commit(); renderLayers(); requestRender(); });
    const name = el('div');
    const meta = [];
    if (L.blend) meta.push(BLENDS[L.blend]);
    if (L.opacity < 1) meta.push(Math.round(L.opacity * 100) + '%');
    name.append(el('div', 'lname', ITEMS[L.item].label), el('div', 'lmeta', meta.join(' · ') || EFFECTS[L.effect].name));
    li.append(eye, name, el('span', 'grip', '⋮⋮'));
    li.addEventListener('click', () => { state.sel = L.id; refreshAll(false); });
    li.addEventListener('dragstart', (e) => { dragId = L.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', L.id); });
    li.addEventListener('dragover', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      li.classList.toggle('drop-above', above);
      li.classList.toggle('drop-below', !above);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-above', 'drop-below'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const above = li.classList.contains('drop-above');
      li.classList.remove('drop-above', 'drop-below');
      if (dragId == null || dragId === L.id) return;
      const moving = state.layers.find((l) => l.id === dragId);
      state.layers = state.layers.filter((l) => l.id !== dragId);
      const ti = state.layers.findIndex((l) => l.id === L.id);
      // list is reversed: "above" in the list means later in the stack
      state.layers.splice(above ? ti + 1 : ti, 0, moving);
      dragId = null;
      commit(); refreshAll();
    });
    li.addEventListener('dragend', () => { dragId = null; });
    ul.append(li);
  }
  $('#delLayer').disabled = $('#dupLayer').disabled = !selLayer();
}
function deleteLayer() {
  const i = state.layers.findIndex((l) => l.id === state.sel);
  if (i < 0) return;
  state.layers.splice(i, 1);
  const n = state.layers[Math.min(i, state.layers.length - 1)];
  state.sel = n ? n.id : null;
  commit(); refreshAll();
}
function duplicateLayer() {
  const L = selLayer();
  if (!L) return;
  const c = { ...JSON.parse(JSON.stringify(L)), id: uid++ };
  const m = L.mask && masks.get(L.mask.id);
  if (m) c.mask = { id: masks.clone(m).id, ver: 0 };
  state.layers.splice(state.layers.indexOf(L) + 1, 0, c);
  state.sel = c.id;
  commit(); refreshAll();
}

function refreshAll(params = true) {
  if (!state.layers.some((l) => l.id === state.sel)) state.sel = state.layers.length ? state.layers[state.layers.length - 1].id : null;
  if (brush.active && !isDB(selLayer())) brush.active = false;
  updateToolUI();
  renderLayers();
  renderParams();
  markGallery();
  requestRender();
}

// ---------------------------------------------------------------- export
function exportImage(type) {
  if (!doc) return;
  const out = engine.run('doc', resolved(), 1);
  engine.present(out, 'doc', -1);
  let src = canvas;
  if (type === 'jpeg') {
    src = document.createElement('canvas');
    src.width = doc.w; src.height = doc.h;
    const g = src.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, doc.w, doc.h);
    g.drawImage(canvas, 0, 0);
  }
  src.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tearsheet-${Date.now()}.${type === 'jpeg' ? 'jpg' : 'png'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    renderNow();
    toast(`Exported ${doc.w}×${doc.h} ${type === 'jpeg' ? 'JPG' : 'PNG'}`);
  }, 'image/' + type, 0.95);
}

// ---------------------------------------------------------------- misc ui
let toastT = 0;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function setCompare(v) {
  const refit = (v === 'stack') !== (view.compare === 'stack');
  view.compare = v;
  if (refit) fit();
  for (const b of document.querySelectorAll('#compare button')) b.classList.toggle('on', b.dataset.v === v);
  applyView(); requestRender();
}

function wire() {
  $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('#sampleBtn').addEventListener('click', loadSample);
  const ds = $('#docSize');
  ds.value = String(state.docLong);
  ds.addEventListener('change', () => { state.docLong = ds.value === 'native' ? 'native' : +ds.value; save(); buildDoc(); });
  const rs = $('#recipeSel');
  RECIPES.forEach((r, i) => rs.append(new Option(r.name, i)));
  rs.addEventListener('change', () => { if (rs.value !== '') applyRecipe(RECIPES[+rs.value]); rs.value = ''; });
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  for (const b of document.querySelectorAll('#compare button')) b.addEventListener('click', () => setCompare(b.dataset.v));
  $('#zoomBtn').addEventListener('click', fit);
  $('#exportPng').addEventListener('click', () => exportImage('png'));
  $('#exportJpg').addEventListener('click', () => exportImage('jpeg'));
  $('#brushBtn').addEventListener('click', () => setTool(!brush.active));
  $('#delLayer').addEventListener('click', deleteLayer);
  $('#dupLayer').addEventListener('click', duplicateLayer);

  // drag & drop / paste
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (f) loadFile(f);
  });

  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range';
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
    if (mod && e.key === '1') {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(1, r.width / 2, r.height / 2); return;
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); exportImage('png'); return; }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; vp.classList.add('panmode'); moveRing(); } return; }
    if (e.key === 'Alt') { if (lastPointer) { lastPointer.altKey = true; moveRing(); } }
    if (!mod && e.key.toLowerCase() === 'o') { setTool(!brush.active); return; }
    if (brush.active && !mod) {
      const k = e.key;
      if (k === '[' || k === '{' || k === ']' || k === '}') {
        const up = k === ']' || k === '}';
        if (e.shiftKey) brush.hardness = Math.min(1, Math.max(0, brush.hardness + (up ? 0.1 : -0.1)));
        else brush.size = Math.min(1500, Math.max(4, Math.round(brush.size * (up ? 1.18 : 1 / 1.18))));
        saveBrush(); moveRing(); renderParams(); return;
      }
      if (k.toLowerCase() === 'x' && brush.mode < 2) { brush.mode = 1 - brush.mode; saveBrush(); moveRing(); renderParams(); return; }
    }
    if (e.key === '\\' && !view.peek) { view.peek = true; applyView(); requestRender(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selLayer()) { e.preventDefault(); deleteLayer(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; vp.classList.remove('panmode'); moveRing(); }
    if (e.key === 'Alt' && lastPointer) { lastPointer.altKey = false; moveRing(); }
    if (e.key === '\\') { view.peek = false; applyView(); requestRender(); }
  });
}

// ---------------------------------------------------------------- boot
const saved = load();
if (saved) state = { ...state, ...saved };
buildGallery();
wire();
if (!saved) {
  const r = RECIPES[0];
  state.layers = r.layers.map(([item, ov, extra]) => makeLayer(item, ov, extra));
  state.sel = state.layers[state.layers.length - 1].id;
}
// No top-level await here: Safari 14 (iPadOS 14) can't parse it.
(async () => {
  for (const L of state.layers) {
    if (!isDB(L)) continue;
    if (L.mask) { L.mask.ver = 0; await masks.restore(L.mask.id); }
    ensureMask(L);
  }
  commit();
  refreshAll();
  loadSample();
})();

// debugging handle
window.tearsheet = { state, engine, masks, brush, applyRecipe, RECIPES, renderNow, setTool, loadFile, srcLimits };
