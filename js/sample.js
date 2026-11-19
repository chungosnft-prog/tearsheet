// Built-in sample: a poster with a full tonal range, saturated colour, soft
// gradients and a step wedge, so every screen has something to chew on.
export function makeSample() {
  const W = 2000, H = 1400;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const TAU = Math.PI * 2;

  let gr = g.createLinearGradient(0, 0, 0, H * 0.66);
  gr.addColorStop(0, '#101a4d');
  gr.addColorStop(0.42, '#6b2c8c');
  gr.addColorStop(0.74, '#ec4a78');
  gr.addColorStop(1, '#ffb347');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);

  // striped retro sun, drawn on its own canvas so the cut-outs only hit the sun
  const sr = 330, sc = document.createElement('canvas');
  sc.width = sc.height = sr * 2;
  const s = sc.getContext('2d');
  gr = s.createLinearGradient(0, 0, 0, sr * 2);
  gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.5, '#ffb02e'); gr.addColorStop(1, '#ff4f3a');
  s.fillStyle = gr;
  s.beginPath(); s.arc(sr, sr, sr, 0, TAU); s.fill();
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) s.fillRect(0, sr + 30 + i * 46 + i * i * 2, sr * 2, 6 + i * 4);
  g.drawImage(sc, W * 0.63 - sr, H * 0.5 - sr);

  const ridge = (base, amp, k, top, bot) => {
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = base - amp * (0.5 * Math.sin(x * 0.0035 + k) + 0.3 * Math.sin(x * 0.0097 + k * 2.1) + 0.2 * Math.sin(x * 0.027 + k * 3.7));
      g.lineTo(x, y);
    }
    g.lineTo(W, H); g.closePath();
    const lg = g.createLinearGradient(0, base - amp, 0, H);
    lg.addColorStop(0, top); lg.addColorStop(1, bot);
    g.fillStyle = lg; g.fill();
  };
  ridge(H * 0.62, 150, 1.3, '#8a3d8f', '#2a1745');
  ridge(H * 0.72, 120, 4.1, '#4a2266', '#160c2a');
  ridge(H * 0.84, 90, 2.4, '#1f1238', '#07040f');

  const sphere = (x, y, r, hi, mid, lo) => {
    const rg = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.04, x, y, r);
    rg.addColorStop(0, hi); rg.addColorStop(0.45, mid); rg.addColorStop(1, lo);
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  };
  sphere(330, 980, 190, '#e9fdff', '#19b6d8', '#03243a');
  sphere(610, 1060, 120, '#fff0fa', '#e2338f', '#3b0622');
  sphere(1640, 1030, 150, '#ffffff', '#9a9a9a', '#111111');

  g.fillStyle = '#fff8ec';
  g.font = '900 220px "Helvetica Neue", "Arial Black", Impact, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText('TEARSHEET', 110, 300);
  g.font = '600 46px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(255,248,236,0.85)';
  g.fillText('HALFTONE · TORN EDGES · Nº 01', 118, 380);

  // step wedge + smooth ramp
  const wy = H - 120, wh = 70, steps = 11, ww = 880;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(110 + (i * ww) / steps, wy, ww / steps + 1, wh);
  }
  gr = g.createLinearGradient(1010, 0, W - 110, 0);
  gr.addColorStop(0, '#00aeef'); gr.addColorStop(0.33, '#ec008c'); gr.addColorStop(0.66, '#fff200'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr;
  g.fillRect(1010, wy, W - 1120, wh);
  return c;
}
