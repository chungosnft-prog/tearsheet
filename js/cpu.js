// CPU effects. Pixel buffers arrive bottom-up straight from readPixels and go
// back the same way, so orientation never matters here.

const KERNELS = [
  { div: 16, pts: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] }, // Floyd–Steinberg
  { div: 8, pts: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] }, // Atkinson
  { div: 48, pts: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] }, // JJN
  { div: 42, pts: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] }, // Stucki
  { div: 32, pts: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] }, // Burkes
  { div: 4, pts: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] }, // Sierra Lite
];

export const hex2rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function errorDiffuse(src, w, h, P, scale) {
  const k = KERNELS[P.algo | 0] || KERNELS[0];
  const b = Math.max(1, Math.round(P.pixel * scale));
  const bw = Math.ceil(w / b), bh = Math.ceil(h / b);
  const rgb = P.mode == 1;
  const ch = rgb ? 3 : 1;
  const buf = new Float32Array(bw * bh * ch);
  const cnt = new Float32Array(bw * bh);
  const ge = Math.pow(2, -(P.gamma || 0)), con = 1 + (P.contrast || 0), br = P.bright || 0;
  const tone = (v) => clamp01((Math.pow(clamp01(v), ge) - 0.5) * con + 0.5 + br);

  for (let y = 0; y < h; y++) {
    const by = (y / b) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, bi = by * bw + ((x / b) | 0);
      cnt[bi]++;
      if (rgb) { buf[bi * 3] += src[i]; buf[bi * 3 + 1] += src[i + 1]; buf[bi * 3 + 2] += src[i + 2]; }
      else buf[bi] += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    }
  }
  for (let bi = 0; bi < bw * bh; bi++) for (let c = 0; c < ch; c++) buf[bi * ch + c] = tone(buf[bi * ch + c] / (cnt[bi] * 255));

  const L = Math.max(2, P.levels | 0) - 1;
  const pts = k.pts, div = k.div;
  for (let y = 0; y < bh; y++) {
    const rev = P.serpentine && (y & 1);
    for (let xi = 0; xi < bw; xi++) {
      const x = rev ? bw - 1 - xi : xi;
      for (let c = 0; c < ch; c++) {
        const i = (y * bw + x) * ch + c;
        const old = buf[i];
        const nv = Math.round(clamp01(old) * L) / L;
        buf[i] = nv;
        const err = old - nv;
        if (err === 0) continue;
        for (let j = 0; j < pts.length; j++) {
          const xx = x + (rev ? -pts[j][0] : pts[j][0]), yy = y + pts[j][1];
          if (xx < 0 || xx >= bw || yy >= bh) continue;
          buf[(yy * bw + xx) * ch + c] += (err * pts[j][2]) / div;
        }
      }
    }
  }

  const out = new Uint8Array(w * h * 4);
  const ink = hex2rgb(P.ink), paper = hex2rgb(P.paper);
  for (let y = 0; y < h; y++) {
    const by = (y / b) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, bi = by * bw + ((x / b) | 0);
      if (rgb) {
        out[i] = buf[bi * 3] * 255; out[i + 1] = buf[bi * 3 + 1] * 255; out[i + 2] = buf[bi * 3 + 2] * 255;
      } else {
        const q = buf[bi];
        out[i] = (ink[0] + (paper[0] - ink[0]) * q) * 255;
        out[i + 1] = (ink[1] + (paper[1] - ink[1]) * q) * 255;
        out[i + 2] = (ink[2] + (paper[2] - ink[2]) * q) * 255;
      }
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}
