// Stacks of gallery entries. Each layer: [itemId, paramOverrides, {blend, opacity}]
export const RECIPES = [
  { name: 'Magazine Cutout', layers: [['cmyk', { size: 6 }], ['torn', { inset: 56, rim: 12, shadow: 0.45 }]] },
  { name: 'Newsprint', layers: [['levels', { contrast: 0.25 }], ['dot-round', { size: 8, ink: '#1b1a1c', paper: '#e9e3d3', gain: 0.25 }], ['spread', { radius: 1, amount: 0.6 }], ['paper', { tintAmt: 0.4, grain: 0.6 }]] },
  { name: 'Pop Art Dots', layers: [['posterize', { levels: 4, contrast: 0.3 }], ['dot-color', { size: 20, paper: '#fff6e0' }], ['misreg', { amount: 4 }]] },
  { name: 'Riso Zine', layers: [['riso', {}], ['torn-deckle', {}]] },
  { name: 'Comic Page', layers: [['cmyk-coarse', {}], ['paper', { tintAmt: 0.5 }], ['folded', { foldsV: 1, foldsH: 0, tintAmt: 0, grain: 0.2, fibers: 0, blotch: 0 }]] },
  { name: 'Engraved Banknote', layers: [['levels', { contrast: 0.3 }], ['engrave', { ink: '#1d3b2a', paper: '#ece6cf' }], ['paper', { tint: '#e9e0c4', tintAmt: 0.6 }]] },
  { name: 'Photocopy Flyer', layers: [['photocopy', {}], ['distress', { amount: 0.22 }], ['handcut', {}]] },
  { name: 'Treasure Map', layers: [['sepia', {}], ['stipple', { ink: '#3b2412', paper: '#e8d6ae', cell: 4, dot: 3.8, contrast: 0.45 }], ['burnt', {}]] },
  { name: 'Ripped Poster', layers: [['riso', { size: 12 }], ['rip', { bgMode: 1, bg: '#2a2930' }]] },
  { name: 'Shredded', layers: [['dot-ellipse', { size: 10, ink: '#1b2a6b', paper: '#f7f1e3' }], ['rip-shred', { bgMode: 1, bg: '#cfc9bc' }]] },
  { name: '1-Bit Atkinson', layers: [['atkinson', { pixel: 2 }]] },
  { name: 'Mezzotint Print', layers: [['mezzo-fine', { grain: 1.5 }], ['paper', {}]] },
  { name: 'Halftone Overlay', layers: [['dot-round', { colorMode: 3, size: 10 }, { blend: 2, opacity: 0.8 }]] },
  { name: 'Pinked Swatch', layers: [['dot-square', { size: 10, angle: 0, colorMode: 1 }], ['pinking', { bgMode: 1, bg: '#e8e2d4', shadow: 0.3 }]] },
];
