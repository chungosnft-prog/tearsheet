import { VERT, COMMON, BLEND, DISPLAY } from './shaders.js';
import { hex2rgb } from './cpu.js';

// WebGL2 effect-stack renderer. Every layer reads one texture and writes
// another; each output gets mipmaps so screens can average a whole cell cheaply.
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('This browser has no WebGL2.');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.progs = new Map();
    this.sources = {};
    this.pools = new Map();
    this.errors = new Map();
    this.vs = this.shader(gl.VERTEX_SHADER, VERT);
    this.emptyMask = this.createMaskTex(1, 1);
  }

  // RG8 paint map (R = dodge, G = burn), rows stored top-down
  createMaskTex(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadMask(tex, 0, 0, w, h, new Uint8Array(w * h * 2));
    return tex;
  }

  uploadMask(tex, x, y, w, h, rg8) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RG, gl.UNSIGNED_BYTE, rg8);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  deleteMaskTex(tex) { this.gl.deleteTexture(tex); }

  bindMask(P, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex || this.emptyMask);
    gl.uniform1i(this.loc(P, 'u_mask'), unit);
    gl.activeTexture(gl.TEXTURE0);
  }

  shader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  }

  program(key, frag) {
    let P = this.progs.get(key);
    if (P) return P;
    const gl = this.gl;
    const fs = this.shader(gl.FRAGMENT_SHADER, frag);
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    P = { prog, locs: new Map() };
    this.progs.set(key, P);
    return P;
  }

  loc(P, name) {
    if (!P.locs.has(name)) P.locs.set(name, this.gl.getUniformLocation(P.prog, name));
    return P.locs.get(name);
  }

  makeTarget(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  freeTarget(t) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  setSource(key, canvasEl) {
    const gl = this.gl;
    const w = canvasEl.width, h = canvasEl.height;
    let t = this.sources[key];
    if (!t || t.w !== w || t.h !== h) {
      if (t) this.freeTarget(t);
      t = this.sources[key] = this.makeTarget(w, h);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, canvasEl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    // drop scratch pools that no source needs any more
    const keep = new Set(Object.values(this.sources).map((s) => s.w + 'x' + s.h));
    for (const [k, pool] of this.pools) if (!keep.has(k)) { pool.forEach((p) => this.freeTarget(p)); this.pools.delete(k); }
  }

  pool(w, h) {
    const k = w + 'x' + h;
    if (!this.pools.has(k)) this.pools.set(k, [this.makeTarget(w, h), this.makeTarget(w, h), this.makeTarget(w, h)]);
    return this.pools.get(k);
  }

  setParams(P, def, params, pxScale) {
    const gl = this.gl;
    for (const d of def.params) {
      if (!d.key) continue;
      const v = params[d.key] ?? d.def;
      const L = this.loc(P, d.type === 'seed' ? 'u_seed' : 'u_' + d.key);
      if (!L) continue;
      if (d.type === 'range') gl.uniform1f(L, d.px ? v * pxScale : v);
      else if (d.type === 'select') gl.uniform1i(L, v | 0);
      else if (d.type === 'bool') gl.uniform1f(L, v ? 1 : 0);
      else if (d.type === 'color') gl.uniform3f(L, ...hex2rgb(v));
      else if (d.type === 'seed') gl.uniform1f(L, v);
    }
  }

  draw(P, input, out, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    gl.uniform1i(this.loc(P, 'u_tex'), 0);
    gl.uniform2f(this.loc(P, 'u_res'), out.w, out.h);
    if (setup) setup(P);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  cpuPass(def, params, input, out, pxScale) {
    const gl = this.gl;
    const { w, h } = out;
    gl.bindFramebuffer(gl.FRAMEBUFFER, input.fbo);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const res = def.cpu(px, w, h, params, pxScale);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, res);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // layers: [{ effect, def, params, blend, opacity }] in application order
  run(srcKey, layers, pxScale = 1) {
    const gl = this.gl;
    const src = this.sources[srcKey];
    const pool = this.pool(src.w, src.h);
    const pick = (...ex) => pool.find((t) => !ex.includes(t));
    let cur = src;
    for (const L of layers) {
      const def = L.def;
      let out;
      try {
        if (def.cpu) {
          out = pick(cur);
          this.cpuPass(def, L.params, cur, out, pxScale);
        } else {
          const P = this.program(L.effect, def.frag);
          let inp = cur;
          for (let i = 0; i < (def.passes || 1); i++) {
            const o = pick(inp, cur);
            this.draw(P, inp, o, (P) => {
              this.setParams(P, def, L.params, pxScale);
              gl.uniform1i(this.loc(P, 'u_pass'), i);
              if (def.mask) {
                this.bindMask(P, 2, L.maskTex);
                gl.uniform1f(this.loc(P, 'u_hasMask'), L.maskTex ? 1 : 0);
                gl.uniform1f(this.loc(P, 'u_demo'), L.demo ? 1 : 0);
              }
            });
            inp = o;
          }
          out = inp;
        }
        this.errors.delete(L.effect);
      } catch (e) {
        if (!this.errors.has(L.effect)) console.error(`[${L.effect}]`, e.message);
        this.errors.set(L.effect, e.message);
        continue;
      }
      if (L.blend || L.opacity < 1) {
        const P = this.program('__blend', COMMON + BLEND);
        const o = pick(cur, out);
        this.draw(P, out, o, (P) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, cur.tex);
          gl.uniform1i(this.loc(P, 'u_base'), 1);
          gl.uniform1f(this.loc(P, 'u_opacity'), L.opacity);
          gl.uniform1i(this.loc(P, 'u_mode'), L.blend | 0);
          gl.activeTexture(gl.TEXTURE0);
        });
        out = o;
      }
      cur = out;
    }
    return cur;
  }

  present(target, srcKey, split, overlayTex = null) {
    const gl = this.gl;
    const src = this.sources[srcKey];
    if (this.canvas.width !== src.w || this.canvas.height !== src.h) {
      this.canvas.width = src.w;
      this.canvas.height = src.h;
    }
    const P = this.program('__display', COMMON + DISPLAY);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, src.w, src.h);
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(this.loc(P, 'u_src'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(this.loc(P, 'u_tex'), 0);
    gl.uniform2f(this.loc(P, 'u_res'), src.w, src.h);
    gl.uniform1f(this.loc(P, 'u_split'), split);
    this.bindMask(P, 2, overlayTex);
    gl.uniform1f(this.loc(P, 'u_showMask'), overlayTex ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // top-down RGBA pixels of a target
  read(target) {
    const gl = this.gl;
    const { w, h } = target;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return out;
  }
}
