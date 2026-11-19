// Painted dodge/burn maps. Each mask is a 16-bit, 2-channel buffer
// (0 = dodge, 1 = burn), rows top-down, at a resolution independent of the
// document so it survives size changes. Every stroke is kept as a before/after
// patch of its bounding box, so history can step a mask to any version.

const MAX = 65535;
const LONG_SIDE = 1280;
const BUDGET = 160e6; // bytes of stroke patches kept for undo
const KEY = 'tearsheet.mask.';

const rid = () => Math.random().toString(36).slice(2, 10);

export class MaskStore {
  constructor(engine) {
    this.engine = engine;
    this.masks = new Map();
  }

  get(id) { return id ? this.masks.get(id) : null; }

  create(aspect = 1.43, id = rid(), w, h) {
    if (!w) {
      w = aspect >= 1 ? LONG_SIDE : Math.round(LONG_SIDE * aspect);
      h = aspect >= 1 ? Math.round(LONG_SIDE / aspect) : LONG_SIDE;
    }
    const m = { id, w, h, data: new Uint16Array(w * h * 2), tex: this.engine.createMaskTex(w, h), strokes: [], cur: 0, base: null, bbox: null, dirty: null };
    this.masks.set(id, m);
    return m;
  }

  clone(src) {
    const m = this.create(1, rid(), src.w, src.h);
    m.data.set(src.data);
    this.markDirty(m, 0, 0, m.w, m.h);
    return m;
  }

  isEmpty(m) {
    for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false;
    return true;
  }

  markDirty(m, x0, y0, x1, y1) {
    const d = m.dirty;
    m.dirty = d ? [Math.min(d[0], x0), Math.min(d[1], y0), Math.max(d[2], x1), Math.max(d[3], y1)] : [x0, y0, x1, y1];
  }

  // ---- strokes
  begin(m) {
    m.base = m.data.slice();
    m.bbox = null;
  }

  // mode 0 dodge, 1 burn, 2 erase. cx, cy, r in mask pixels; amt 0..1 per dab
  dab(m, cx, cy, r, hard, amt, mode) {
    r = Math.max(r, 0.75);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(m.w, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(m.h, Math.ceil(cy + r));
    if (x0 >= x1 || y0 >= y1) return;
    const d = m.data, w = m.w, inv = 1 / r, soft = Math.max(1 - hard, 1e-3);
    const add = amt * MAX;
    for (let y = y0; y < y1; y++) {
      const dy = (y + 0.5 - cy) * inv;
      for (let x = x0; x < x1; x++) {
        const dx = (x + 0.5 - cx) * inv;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 1) continue;
        let f = 1;
        if (dist > hard) { const t = (1 - dist) / soft; f = t * t * (3 - 2 * t); }
        const i = (y * w + x) * 2;
        if (mode === 2) {
          const k = 1 - f * amt;
          d[i] *= k; d[i + 1] *= k;
        } else {
          const j = i + mode;
          const v = d[j] + add * f;
          d[j] = v > MAX ? MAX : v;
        }
      }
    }
    const b = m.bbox;
    m.bbox = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1];
    this.markDirty(m, x0, y0, x1, y1);
  }

  fill(m, value) {
    m.data.fill(value);
    m.bbox = [0, 0, m.w, m.h];
    this.markDirty(m, 0, 0, m.w, m.h);
  }

  // returns true when the stroke changed something (and was recorded)
  end(m) {
    const bb = m.bbox, base = m.base;
    m.base = null; m.bbox = null;
    if (!bb) return false;
    const before = this.crop(base, m.w, bb), after = this.crop(m.data, m.w, bb);
    let changed = false;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) { changed = true; break; }
    if (!changed) return false;
    m.strokes = m.strokes.filter((s) => s.ver <= m.cur);
    m.cur++;
    m.strokes.push({ ver: m.cur, rect: bb, before, after, t: performance.now() });
    let bytes = 0;
    for (const s of this.masks.values()) for (const k of s.strokes) bytes += k.before.byteLength * 2;
    while (bytes > BUDGET) {
      // evict the oldest patch across all masks
      let oldest = null;
      for (const s of this.masks.values()) if (s.strokes.length && (!oldest || s.strokes[0].t < oldest.strokes[0].t)) oldest = s;
      if (!oldest) break;
      bytes -= oldest.strokes.shift().before.byteLength * 2;
    }
    return true;
  }

  crop(src, w, [x0, y0, x1, y1]) {
    const cw = x1 - x0, out = new Uint16Array(cw * (y1 - y0) * 2);
    for (let y = y0; y < y1; y++) out.set(src.subarray((y * w + x0) * 2, (y * w + x1) * 2), (y - y0) * cw * 2);
    return out;
  }

  paste(m, [x0, y0, x1, y1], patch) {
    const cw = x1 - x0;
    for (let y = y0; y < y1; y++) m.data.set(patch.subarray((y - y0) * cw * 2, (y - y0 + 1) * cw * 2), (y * m.w + x0) * 2);
    this.markDirty(m, x0, y0, x1, y1);
  }

  // step the mask to a recorded version (undo / redo)
  seek(m, ver) {
    const find = (v) => m.strokes.find((s) => s.ver === v);
    while (m.cur > ver) { const s = find(m.cur); if (!s) break; this.paste(m, s.rect, s.before); m.cur--; }
    while (m.cur < ver) { const s = find(m.cur + 1); if (!s) break; this.paste(m, s.rect, s.after); m.cur++; }
  }

  // ---- GPU
  flush(m) {
    if (!m.dirty) return;
    const [x0, y0, x1, y1] = m.dirty;
    m.dirty = null;
    const cw = x1 - x0, ch = y1 - y0;
    const out = new Uint8Array(cw * ch * 2);
    for (let y = 0; y < ch; y++) {
      let i = ((y + y0) * m.w + x0) * 2, o = y * cw * 2;
      for (let k = 0; k < cw * 2; k++) out[o++] = m.data[i++] >> 8;
    }
    this.engine.uploadMask(m.tex, x0, y0, cw, ch, out);
  }
  flushAll() { for (const m of this.masks.values()) this.flush(m); }

  // ---- persistence (8-bit PNG in localStorage; best effort)
  save(m) {
    try {
      if (this.isEmpty(m)) { localStorage.removeItem(KEY + m.id); return; }
      const c = document.createElement('canvas');
      c.width = m.w; c.height = m.h;
      const g = c.getContext('2d');
      const img = g.createImageData(m.w, m.h);
      for (let i = 0, j = 0; i < m.w * m.h; i++, j += 4) {
        img.data[j] = m.data[i * 2] >> 8;
        img.data[j + 1] = m.data[i * 2 + 1] >> 8;
        img.data[j + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      localStorage.setItem(KEY + m.id, c.toDataURL('image/png'));
    } catch (e) {
      console.warn('Dodge & burn mask too large to keep between sessions', e);
    }
  }

  async restore(id) {
    let url;
    try { url = localStorage.getItem(KEY + id); } catch {}
    if (!url) return null;
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { return null; }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const m = this.masks.get(id) || this.create(1, id, c.width, c.height);
    if (m.w !== c.width || m.h !== c.height) return m;
    for (let i = 0, j = 0; i < m.w * m.h; i++, j += 4) { m.data[i * 2] = px[j] * 257; m.data[i * 2 + 1] = px[j + 1] * 257; }
    this.markDirty(m, 0, 0, m.w, m.h);
    return m;
  }

  prune(keepIds) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KEY) && !keepIds.has(k.slice(KEY.length))) localStorage.removeItem(k);
      }
    } catch {}
  }
}
