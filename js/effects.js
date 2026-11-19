import * as S from './shaders.js';
import { errorDiffuse } from './cpu.js';

// ---- param helpers -------------------------------------------------------
const r = (key, label, min, max, def, step = 0.01, extra = {}) => ({ type: 'range', key, label, min, max, def, step, ...extra });
const px = (key, label, min, max, def, step = 1, extra = {}) => r(key, label, min, max, def, step, { px: true, unit: 'px', ...extra });
const deg = (key, label, def, min = -180, max = 180) => r(key, label, min, max, def, 1, { unit: '°' });
const sel = (key, label, options, def = 0) => ({ type: 'select', key, label, options, def });
const col = (key, label, def) => ({ type: 'color', key, label, def });
const bool = (key, label, def = false, extra = {}) => ({ type: 'bool', key, label, def, ...extra });
const seed = () => ({ type: 'seed', key: 'seed', label: 'Seed', def: 1 });
const sec = (section) => ({ section });

const TONE = [sec('Tone'), r('bright', 'Brightness', -1, 1, 0), r('contrast', 'Contrast', -1, 3, 0), r('gamma', 'Midtones', -2, 2, 0)];
const DOT_TONE = [...TONE, r('gain', 'Dot gain', -0.8, 2, 0), bool('invert', 'Invert tones')];

const SHAPES = ['Round', 'Ellipse', 'Square', 'Diamond', 'Line', 'Cross', 'Ring', 'Triangle', 'Hexagon', 'Star'];
const SOURCES = ['Luminance', 'Cyan', 'Magenta', 'Yellow', 'Black (K)', 'Red (inverted)', 'Green (inverted)', 'Blue (inverted)', 'Highlights'];
const COLOR_MODES = ['Ink on paper', 'Image colours', 'Ink over image', 'Ink only (transparent)'];
const STYLES = ['Torn', 'Pinking', 'Scalloped', 'Hand cut'];
const BLENDS = ['Normal (replace)', 'Over', 'Multiply', 'Screen', 'Overlay', 'Soft light', 'Darken', 'Lighten', 'Difference'];
export { BLENDS };

const INK = '#141317', PAPER = '#f4efe4';
const SCREEN_EXTRAS = [px('soft', 'Edge softness', 0.2, 4, 1, 0.1), bool('pointSample', 'Hard sampling')];

const EDGES = [bool('top', 'Top', true, { chip: true }), bool('bottom', 'Bottom', true, { chip: true }), bool('left', 'Left', true, { chip: true }), bool('right', 'Right', true, { chip: true })];
const TEAR_SHAPE = [
  sel('style', 'Edge style', STYLES, 0),
  px('rough', 'Roughness', 0, 200, 22),
  px('scale', 'Tear scale', 4, 600, 90),
  r('jag', 'Jaggedness', 0.3, 0.8, 0.58),
  px('micro', 'Micro fray', 0, 8, 1.5, 0.1),
  px('period', 'Tooth / cut size', 4, 200, 24),
];
const SHADOW = [sec('Shadow'), r('shadow', 'Opacity', 0, 1, 0.35), px('shadowBlur', 'Blur', 0, 80, 14), px('shadowX', 'Offset X', -60, 60, 6), px('shadowY', 'Offset Y', -60, 60, 10)];
const BG = [sec('Background'), sel('bgMode', 'Behind', ['Transparent', 'Colour'], 0), col('bg', 'Colour', '#d8d3c8')];

// ---- effects -------------------------------------------------------------
export const EFFECTS = {
  halftone: {
    name: 'Dot Halftone', frag: S.COMMON + S.HALFTONE,
    params: [sec('Screen'), px('size', 'Cell size', 2, 120, 12, 0.5), deg('angle', 'Angle', 45), sel('shape', 'Dot shape', SHAPES), sel('source', 'Separation', SOURCES),
      r('jitter', 'Jitter', 0, 1, 0), ...SCREEN_EXTRAS,
      sec('Colour'), sel('colorMode', 'Output', COLOR_MODES), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...DOT_TONE, seed()],
  },
  cmyk: {
    name: 'CMYK Process', frag: S.COMMON + S.CMYK,
    params: [sec('Screen'), px('size', 'Cell size', 2, 80, 9, 0.5), sel('shape', 'Dot shape', SHAPES), deg('angC', 'Cyan angle', 15), deg('angM', 'Magenta angle', 75), deg('angY', 'Yellow angle', 0), deg('angK', 'Black angle', 45),
      r('gcr', 'Black generation', 0, 1, 0.8), px('misreg', 'Misregistration', 0, 20, 0, 0.1), ...SCREEN_EXTRAS,
      sec('Inks'), r('inkAlpha', 'Ink density', 0, 1, 1), col('inkC', 'Cyan', '#00aeef'), col('inkM', 'Magenta', '#ec008c'), col('inkY', 'Yellow', '#fff200'), col('inkK', 'Black', '#231f20'), col('paper', 'Paper', PAPER),
      ...TONE, r('gain', 'Dot gain', -0.8, 2, 0), seed()],
  },
  riso: {
    name: 'Riso 2-Colour', frag: S.COMMON + S.RISO,
    params: [sec('Screen'), sel('screen', 'Screen', ['Dot screen', 'Grain'], 0), px('size', 'Cell size', 2, 80, 10, 0.5), sel('shape', 'Dot shape', SHAPES), px('misreg', 'Misregistration', 0, 30, 3, 0.1), r('grain', 'Ink grain', 0, 1, 0.35), ...SCREEN_EXTRAS,
      sec('Ink A'), col('inkA', 'Colour', '#ff48b0'), sel('srcA', 'Separation', SOURCES, 2), deg('angA', 'Angle', 22), r('densA', 'Density', 0, 1, 1),
      sec('Ink B'), col('inkB', 'Colour', '#0078bf'), sel('srcB', 'Separation', SOURCES, 0), deg('angB', 'Angle', 67), r('densB', 'Density', 0, 1, 1),
      col('paper', 'Paper', '#f3eee3'), ...TONE, r('gain', 'Dot gain', -0.8, 2, 0), seed()],
  },
  lines: {
    name: 'Line Screen', frag: S.COMMON + S.LINES,
    params: [sec('Screen'), px('size', 'Line spacing', 2, 80, 8, 0.5), deg('angle', 'Angle', 30), sel('source', 'Separation', SOURCES), px('soft', 'Edge softness', 0.2, 4, 1, 0.1),
      sec('Distort'), px('waveAmp', 'Wave height', 0, 60, 0, 0.5), px('waveLen', 'Wavelength', 4, 400, 80), r('engrave', 'Engrave (contour)', 0, 2, 0),
      sec('Colour'), sel('colorMode', 'Output', COLOR_MODES), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...DOT_TONE],
  },
  circles: {
    name: 'Concentric Screen', frag: S.COMMON + S.CIRCLES,
    params: [sec('Screen'), px('size', 'Ring spacing', 2, 80, 8, 0.5), r('cx', 'Centre X', 0, 1, 0.5), r('cy', 'Centre Y', 0, 1, 0.5), bool('spiral', 'Spiral'), px('waveAmp', 'Ripple', 0, 30, 0, 0.5),
      sel('source', 'Separation', SOURCES), px('soft', 'Edge softness', 0.2, 4, 1, 0.1),
      sec('Colour'), sel('colorMode', 'Output', COLOR_MODES), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...DOT_TONE],
  },
  crosshatch: {
    name: 'Crosshatch', frag: S.COMMON + S.CROSSHATCH,
    params: [sec('Hatching'), px('spacing', 'Spacing', 2, 40, 7, 0.5), px('width', 'Stroke width', 0.3, 12, 1.6, 0.1), deg('angle', 'Angle', 45), r('layers', 'Layers', 1, 4, 4, 1),
      r('wobble', 'Wobble', 0, 1, 0.25), r('breaks', 'Broken strokes', 0, 1, 0.15), px('soft', 'Edge softness', 0.2, 4, 1, 0.1),
      sec('Colour'), sel('colorMode', 'Output', COLOR_MODES), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE, seed()],
  },
  stipple: {
    name: 'Stipple', frag: S.COMMON + S.STIPPLE,
    params: [sec('Dots'), px('cell', 'Spacing', 2, 40, 5, 0.5), px('dot', 'Dot size', 0.5, 24, 4.6, 0.1), r('var', 'Size variation', 0, 1, 0.4), r('density', 'Density curve', 0.3, 3, 1),
      px('soft', 'Edge softness', 0.2, 4, 1, 0.1),
      sec('Colour'), sel('colorMode', 'Output', COLOR_MODES), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE, seed()],
  },
  dither: {
    name: 'Ordered Dither', frag: S.COMMON + S.DITHER,
    params: [sec('Dither'), sel('matrix', 'Pattern', ['Bayer 2×2', 'Bayer 4×4', 'Bayer 8×8', 'Bayer 16×16', 'Cluster 4×4', 'Cluster 8×8', 'Lines', 'Diagonal', 'White noise'], 2),
      px('pixel', 'Pixel size', 1, 32, 2, 1), r('spread', 'Pattern strength', 0, 1, 1),
      sec('Colour'), sel('mode', 'Palette', ['Ink → paper ramp', 'RGB levels']), r('levels', 'Levels', 2, 8, 2, 1), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE, seed()],
  },
  errdiff: {
    name: 'Error Diffusion', cpu: errorDiffuse,
    params: [sec('Diffusion'), sel('algo', 'Algorithm', ['Floyd–Steinberg', 'Atkinson', 'Jarvis-Judice-Ninke', 'Stucki', 'Burkes', 'Sierra Lite']),
      px('pixel', 'Pixel size', 1, 16, 2, 1), bool('serpentine', 'Serpentine scan', true),
      sec('Colour'), sel('mode', 'Palette', ['Ink → paper ramp', 'RGB levels']), r('levels', 'Levels', 2, 8, 2, 1), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE],
  },
  mezzotint: {
    name: 'Mezzotint', frag: S.COMMON + S.MEZZOTINT,
    params: [sec('Mezzotint'), sel('type', 'Type', ['Fine dots', 'Grainy dots', 'Coarse dots', 'Short lines', 'Long lines', 'Strokes']), px('grain', 'Grain size', 0.5, 16, 2, 0.1), deg('angle', 'Stroke angle', 0),
      sec('Colour'), sel('color', 'Output', ['Ink on paper', 'RGB']), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE, seed()],
  },
  torn: {
    name: 'Torn Paper', frag: S.COMMON + S.EDGE + S.TORN,
    params: [sec('Edge'), ...TEAR_SHAPE, px('inset', 'Inset', 0, 400, 40), ...EDGES,
      sec('Paper'), px('rim', 'White rim', 0, 80, 10, 0.5), px('fiber', 'Fibres', 0, 30, 6, 0.5), col('rimColor', 'Paper colour', '#f7f4ec'), r('edgeShade', 'Lip shading', 0, 1, 0.5),
      ...SHADOW, ...BG, seed()],
  },
  rip: {
    name: 'Ripped in Two', frag: S.COMMON + S.EDGE + S.RIP,
    params: [sec('Tear line'), r('pos', 'Position', 0, 1, 0.5), deg('angle', 'Angle', 4, -90, 90), px('gap', 'Gap', 0, 400, 36), px('drift', 'Slide', -300, 300, 0), r('tilt', 'Twist', -30, 30, 2.5, 0.1, { unit: '°' }),
      ...TEAR_SHAPE.map(p => p.key === 'rough' ? { ...p, def: 32 } : p.key === 'scale' ? { ...p, def: 140 } : p),
      sec('Paper'), px('rimA', 'Rim (lower piece)', 0, 80, 12, 0.5), px('rimB', 'Rim (upper piece)', 0, 80, 3, 0.5), px('fiber', 'Fibres', 0, 30, 7, 0.5), col('rimColor', 'Paper colour', '#f7f4ec'), r('edgeShade', 'Lip shading', 0, 1, 0.5),
      ...SHADOW, ...BG, seed()],
  },
  burn: {
    name: 'Burnt Edge', frag: S.COMMON + S.EDGE + S.BURN,
    params: [sec('Edge'), px('inset', 'Inset', 0, 400, 30), px('rough', 'Roughness', 0, 200, 28), px('scale', 'Tear scale', 4, 600, 120), r('jag', 'Jaggedness', 0.3, 0.8, 0.6), px('micro', 'Micro fray', 0, 8, 1, 0.1), ...EDGES,
      sec('Burn'), px('burn', 'Scorch depth', 0, 300, 70), col('char', 'Char', '#160d07'), r('ember', 'Ember glow', 0, 2, 0.6), col('emberColor', 'Ember colour', '#ff7a1a'), r('scorch', 'Scorch spots', 0, 1, 0.3),
      ...BG, seed()],
  },
  tornClassic: {
    name: 'Torn Edges (classic)', frag: S.COMMON + S.TORN_CLASSIC,
    params: [sec('Torn edges'), r('balance', 'Image balance', 0, 1, 0.5), px('smooth', 'Smoothness', 0, 24, 2, 0.5), px('rough', 'Raggedness', 0, 40, 6, 0.5), px('scale', 'Rag scale', 2, 200, 30), r('sharp', 'Contrast', 1, 30, 8, 0.5), r('grit', 'Grit', 0, 1, 0.4),
      sec('Colour'), col('fg', 'Foreground', INK), col('bg', 'Background', PAPER), ...TONE, seed()],
  },
  distress: {
    name: 'Distressed Ink', frag: S.COMMON + S.DISTRESS,
    params: [sec('Wear'), r('amount', 'Amount', 0, 1, 0.35), px('scale', 'Blotch scale', 4, 400, 60), r('speckle', 'Speckle', 0, 1, 0.5), px('speckSize', 'Speck size', 0.5, 8, 1.5, 0.1),
      r('scratch', 'Scratches', 0, 1, 0.2), deg('angle', 'Scratch angle', 80),
      sec('Show through'), sel('target', 'Worn areas', ['Paper colour', 'Transparent']), col('paper', 'Paper', PAPER), seed()],
  },
  paper: {
    name: 'Paper Texture', frag: S.COMMON + S.PAPER,
    params: [sec('Paper'), col('tint', 'Stock colour', '#efe6d2'), r('tintAmt', 'Stock tint', 0, 1, 0.7), r('grain', 'Grain', 0, 1, 0.5), r('fibers', 'Fibres', 0, 1, 0.4), r('blotch', 'Mottling', 0, 1, 0.35),
      sec('Folds'), r('foldsV', 'Vertical folds', 0, 4, 0, 1), r('foldsH', 'Horizontal folds', 0, 4, 0, 1), r('foldStrength', 'Crease strength', 0, 2, 1), seed()],
  },
  spread: {
    name: 'Ink Spread', frag: S.COMMON + S.SPREAD,
    params: [sec('Spread'), px('radius', 'Radius', 0, 20, 2, 0.1), r('amount', 'Amount', 0, 1, 1), r('rough', 'Raggedness', 0, 1, 0.6), seed()],
  },
  misreg: {
    name: 'Misregistration', frag: S.COMMON + S.MISREG,
    params: [sec('Plates'), px('amount', 'Shift', 0, 60, 6, 0.5), deg('angle', 'Direction', 30), sel('mode', 'Mode', ['Split', 'Random per plate']), seed()],
  },
  photocopy: {
    name: 'Photocopy', frag: S.COMMON + S.PHOTOCOPY,
    params: [sec('Copier'), r('threshold', 'Threshold', 0, 1, 0.5), r('detail', 'Edge detail', 0, 1, 0.5), r('toner', 'Toner specks', 0, 1, 0.3), r('streaks', 'Streaks', 0, 1, 0.3), r('edgeDark', 'Edge darkening', 0, 1, 0.4),
      sec('Colour'), col('ink', 'Toner', INK), col('paper', 'Paper', '#f1efe9'), ...TONE, seed()],
  },
  grain: {
    name: 'Film Grain', frag: S.COMMON + S.GRAIN,
    params: [sec('Grain'), r('amount', 'Amount', 0, 1, 0.25), px('gsize', 'Size', 1, 8, 1.2, 0.1), bool('mono', 'Monochrome', true), seed()],
  },
  levels: {
    name: 'Levels & Tone', frag: S.COMMON + S.LEVELS,
    params: [sec('Levels'), r('black', 'Black point', 0, 1, 0), r('white', 'White point', 0, 1, 1), r('bright', 'Brightness', -1, 1, 0), r('contrast', 'Contrast', -1, 3, 0), r('gamma', 'Midtones', -2, 2, 0),
      r('sat', 'Saturation', -1, 2, 0), sec('Tint'), col('tint', 'Tint colour', '#a4743c'), r('tintAmt', 'Tint amount', 0, 1, 0)],
  },
  posterize: { name: 'Posterize', frag: S.COMMON + S.POSTERIZE, params: [sec('Posterize'), r('levels', 'Levels', 2, 16, 5, 1), ...TONE] },
  threshold: {
    name: 'Threshold', frag: S.COMMON + S.THRESHOLD,
    params: [sec('Threshold'), r('level', 'Level', 0, 1, 0.5), r('softness', 'Softness', 0, 0.3, 0.02), col('ink', 'Ink', INK), col('paper', 'Paper', PAPER), ...TONE],
  },
  blur: { name: 'Gaussian Blur', frag: S.COMMON + S.BLUR, passes: 2, params: [sec('Blur'), px('radius', 'Radius', 0, 100, 6, 0.5)] },
  sharpen: { name: 'Sharpen', frag: S.COMMON + S.SHARPEN, params: [sec('Unsharp mask'), r('amount', 'Amount', 0, 4, 1), px('radius', 'Radius', 0.5, 16, 2, 0.1)] },
  pixelate: { name: 'Pixelate', frag: S.COMMON + S.PIXELATE, params: [sec('Mosaic'), px('cell', 'Cell size', 2, 100, 12)] },
};

// ---- gallery: entries are effects with tuned starting values -------------
export const GALLERY = [
  { cat: 'Halftone', items: [
    ['dot-round', 'Round Dot', 'halftone', {}],
    ['dot-ellipse', 'Ellipse Chain', 'halftone', { shape: 1 }],
    ['dot-square', 'Square Dot', 'halftone', { shape: 2 }],
    ['dot-diamond', 'Diamond', 'halftone', { shape: 3 }],
    ['dot-ring', 'Ring', 'halftone', { shape: 6, size: 14 }],
    ['dot-cross', 'Cross', 'halftone', { shape: 5 }],
    ['dot-tri', 'Triangle', 'halftone', { shape: 7, angle: 0, size: 14 }],
    ['dot-hex', 'Hex', 'halftone', { shape: 8, angle: 0 }],
    ['dot-star', 'Star', 'halftone', { shape: 9, angle: 0, size: 16 }],
    ['dot-color', 'Colour Dots', 'halftone', { colorMode: 1, size: 14, paper: '#fffaf0' }],
    ['dot-jitter', 'Organic Dot', 'halftone', { jitter: 0.6, size: 9, gain: 0.3 }],
    ['cmyk', 'CMYK Process', 'cmyk', {}],
    ['cmyk-coarse', 'Comic CMYK', 'cmyk', { size: 16, misreg: 2.5, gain: 0.2 }],
    ['riso', 'Riso 2-Colour', 'riso', {}],
    ['riso-grain', 'Riso Grain', 'riso', { screen: 1, inkA: '#ffe800', srcA: 8, inkB: '#3255a4', grain: 0.25 }],
    ['lines', 'Line Screen', 'lines', {}],
    ['wavy', 'Wavy Lines', 'lines', { waveAmp: 5, waveLen: 70, angle: 0 }],
    ['engrave', 'Engraving', 'lines', { engrave: 0.7, angle: 30, size: 7 }],
    ['concentric', 'Concentric', 'circles', {}],
    ['spiral', 'Spiral', 'circles', { spiral: true, size: 7 }],
    ['hatch', 'Crosshatch', 'crosshatch', {}],
    ['stipple', 'Stipple', 'stipple', {}],
  ] },
  { cat: 'Dither & Grain', items: [
    ['bayer', 'Bayer 8×8', 'dither', {}],
    ['bayer-color', 'Bayer Colour', 'dither', { matrix: 1, mode: 1, levels: 2, pixel: 3 }],
    ['cluster', 'Clustered Dot', 'dither', { matrix: 5, pixel: 1 }],
    ['dither-lines', 'Line Dither', 'dither', { matrix: 7, pixel: 1 }],
    ['fs', 'Floyd–Steinberg', 'errdiff', { algo: 0 }],
    ['atkinson', 'Atkinson', 'errdiff', { algo: 1 }],
    ['jjn', 'Jarvis', 'errdiff', { algo: 2 }],
    ['ed-color', 'Diffusion Colour', 'errdiff', { algo: 3, mode: 1, levels: 2, pixel: 3 }],
    ['mezzo-fine', 'Mezzotint Dots', 'mezzotint', { type: 0 }],
    ['mezzo-grain', 'Grainy', 'mezzotint', { type: 1, grain: 1.5 }],
    ['mezzo-coarse', 'Coarse', 'mezzotint', { type: 2, grain: 2.5 }],
    ['mezzo-lines', 'Mezzo Lines', 'mezzotint', { type: 4, grain: 1.5 }],
    ['mezzo-strokes', 'Strokes', 'mezzotint', { type: 5, grain: 2, angle: -35 }],
    ['mezzo-color', 'Mezzo Colour', 'mezzotint', { type: 0, color: 1, grain: 1.5 }],
  ] },
  { cat: 'Torn & Edges', items: [
    ['torn', 'Torn Paper', 'torn', {}],
    ['torn-deckle', 'Deckle Edge', 'torn', { rough: 5, scale: 26, jag: 0.62, micro: 2.2, inset: 24, rim: 0, fiber: 4, shadow: 0.2, shadowBlur: 6, shadowX: 2, shadowY: 3, edgeShade: 0 }],
    ['torn-strip', 'Torn Strip', 'torn', { left: false, right: false, inset: 90, rough: 50, scale: 160, rim: 14, fiber: 8 }],
    ['torn-corner', 'Torn Corner', 'torn', { top: false, left: false, inset: 30, rough: 70, scale: 260, rim: 16 }],
    ['rip', 'Ripped in Two', 'rip', {}],
    ['rip-diag', 'Diagonal Rip', 'rip', { angle: -32, gap: 60, tilt: -5, drift: 20, pos: 0.48 }],
    ['rip-shred', 'Shred Gap', 'rip', { angle: 88, gap: 90, tilt: 0, rough: 60, scale: 80, rimA: 18, rimB: 10 }],
    ['pinking', 'Pinking Shears', 'torn', { style: 1, rough: 14, period: 22, micro: 0.3, rim: 0, fiber: 0, inset: 30 }],
    ['scallop', 'Scalloped', 'torn', { style: 2, rough: 18, period: 46, micro: 0.3, rim: 0, fiber: 0, inset: 30 }],
    ['handcut', 'Hand Cut', 'torn', { style: 3, rough: 30, period: 150, micro: 0.4, rim: 0, fiber: 0, inset: 36, shadow: 0.45 }],
    ['burnt', 'Burnt Edge', 'burn', {}],
    ['torn-classic', 'Torn Edges', 'tornClassic', {}],
    ['distress', 'Distressed Ink', 'distress', {}],
  ] },
  { cat: 'Print & Texture', items: [
    ['paper', 'Paper Texture', 'paper', {}],
    ['folded', 'Folded Sheet', 'paper', { foldsV: 1, foldsH: 1, foldStrength: 1.2 }],
    ['spread', 'Ink Spread', 'spread', {}],
    ['misreg', 'Misregistration', 'misreg', {}],
    ['photocopy', 'Photocopy', 'photocopy', {}],
    ['grain', 'Film Grain', 'grain', {}],
  ] },
  { cat: 'Adjust', items: [
    ['levels', 'Levels & Tone', 'levels', {}],
    ['sepia', 'Sepia Tint', 'levels', { tintAmt: 0.85, contrast: 0.1 }],
    ['posterize', 'Posterize', 'posterize', {}],
    ['threshold', 'Threshold', 'threshold', {}],
    ['blur', 'Blur', 'blur', {}],
    ['sharpen', 'Sharpen', 'sharpen', {}],
    ['pixelate', 'Pixelate', 'pixelate', {}],
  ] },
];

export const ITEMS = {};
for (const g of GALLERY) for (const [id, label, effect, set] of g.items) ITEMS[id] = { id, label, effect, set, cat: g.cat };

export function defaultsFor(itemId, overrides = {}) {
  const it = ITEMS[itemId];
  const def = EFFECTS[it.effect];
  const params = {};
  for (const p of def.params) if (p.key) params[p.key] = p.def;
  return { ...params, ...it.set, ...overrides };
}
