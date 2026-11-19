# Tearsheet

A browser filter gallery focused on halftones and torn edges. Everything renders on the GPU (WebGL2), so effect stacks update live.

- **Halftone:** dot screens in 10 shapes, CMYK process, riso 2-colour, line / wavy / engraving, concentric & spiral, crosshatch, stipple
- **Dither & grain:** Bayer, clustered dot, error diffusion (Floyd–Steinberg, Atkinson, JJN, Stucki…), mezzotint
- **Torn & edges:** torn paper with white rim + fibres, deckle, ripped in two, shred gap, pinking shears, scalloped, hand cut, burnt edge, classic torn edges, distressed ink
- **Dodge & burn:** paint lighten/darken strokes (shadows / midtones / highlights range, exposure, hardness) on a layer that feeds the screens above it
- **Print & texture / adjust:** paper + folds, ink spread, misregistration, photocopy, grain, levels, posterize, threshold, blur, sharpen, pixelate

Stack effects as layers with blend modes and opacity, start from recipes, then export a PNG (with transparency) or JPG.

Run locally: `python3 -m http.server 5196` in this folder, then open http://localhost:5196.
