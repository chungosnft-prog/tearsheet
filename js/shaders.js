// GLSL sources. Every effect shader works in y-down pixel space: P() is the
// current pixel, samp(p) reads the layer input at pixel p.

export const VERT = `#version 300 es
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_seed;
uniform float u_bright;
uniform float u_contrast;
uniform float u_gamma;
uniform float u_gain;
uniform float u_gcr;
uniform float u_jitter;
uniform float u_invert;
uniform float u_soft;
uniform float u_pointSample;
uniform int u_pass;
out vec4 fragColor;
#define PI 3.14159265359
#define TAU 6.28318530718

vec2 P(){ return vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); }
vec2 toUV(vec2 p){ return vec2(p.x, u_res.y - p.y) / u_res; }
vec4 samp(vec2 p){ return texture(u_tex, toUV(p)); }
vec4 sampLod(vec2 p, float lod){ return textureLod(u_tex, toUV(p), lod); }
float inside(vec2 p){ vec2 a = clamp(p + 0.5, 0.0, 1.0) * clamp(u_res - p + 0.5, 0.0, 1.0); return a.x * a.y; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct, float gain){
  float s = 0.0, a = 0.5, n = 0.0;
  for(int i = 0; i < 8; i++){ if(i >= oct) break; s += a * vnoise(p); n += a; a *= gain; p = p * 2.03 + vec2(17.13, 9.71); }
  return s / n;
}
vec4 overC(vec4 top, vec4 bot){
  float a = top.a + bot.a * (1.0 - top.a);
  vec3 c = (top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / max(a, 1e-5);
  return vec4(c, a);
}
float tone(float l){
  l = pow(clamp(l, 0.0, 1.0), exp2(-u_gamma));
  return clamp((l - 0.5) * (1.0 + u_contrast) + 0.5 + u_bright, 0.0, 1.0);
}
vec3 tone3(vec3 c){ return vec3(tone(c.r), tone(c.g), tone(c.b)); }
vec4 rgb2cmyk(vec3 c){
  vec3 cmy = 1.0 - c;
  float k = min(cmy.x, min(cmy.y, cmy.z)) * u_gcr;
  return vec4(clamp((cmy - k) / max(1.0 - k, 1e-4), 0.0, 1.0), k);
}
// darkness (ink amount) 0..1 for a sample, from a chosen separation source
float srcDark(vec4 s, int src){
  vec3 c = tone3(s.rgb);
  float d;
  if(src == 0) d = 1.0 - luma(c);
  else if(src <= 4){ vec4 k = rgb2cmyk(c); d = src == 1 ? k.x : (src == 2 ? k.y : (src == 3 ? k.z : k.w)); }
  else if(src == 5) d = 1.0 - c.r;
  else if(src == 6) d = 1.0 - c.g;
  else if(src == 7) d = 1.0 - c.b;
  else d = luma(c);
  if(u_invert > 0.5) d = 1.0 - d;
  d = 1.0 - pow(1.0 - clamp(d, 0.0, 1.0), 1.0 + u_gain);
  return clamp(d, 0.0, 1.0);
}
float sdTri(vec2 p, float r){
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if(p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0*r, 0.0);
  return -length(p) * sign(p.y);
}
float sdHex(vec2 p, float r){
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p); p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
  return length(p) * sign(p.y);
}
float sdStar5(vec2 p, float r, float rf){
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x); p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba*h) * sign(p.y*ba.x - p.x*ba.y);
}
// signed distance of a halftone dot for darkness d in a cell of size s
float shapeSD(int shape, vec2 q, float d, float s){
  float f = smoothstep(0.82, 1.0, d);
  if(shape == 0){ return length(q) - mix(0.5642*sqrt(d), 0.7072, f) * s; }
  if(shape == 1){ float r = mix(0.5642*sqrt(d), 0.95, f) * s; return (length(q / vec2(1.3, 0.77)) - r) * 0.77; }
  if(shape == 2){ vec2 a = abs(q); return max(a.x, a.y) - 0.5*sqrt(d)*s; }
  if(shape == 3){ vec2 a = abs(q); return (a.x + a.y - mix(0.7072*sqrt(d), 1.0, f)*s) * 0.7072; }
  if(shape == 4){ return abs(q.y) - 0.5*d*s; }
  if(shape == 5){ float w = s * (1.0 - sqrt(max(1.0 - d, 0.0))); vec2 a = abs(q); return max(min(a.x, a.y) - 0.5*w, max(a.x, a.y) - 0.5*s); }
  if(shape == 6){ float R = mix(s*sqrt(d / (PI*0.75)), 0.7072*s, f); float ri = R * 0.5 * (1.0 - f); return abs(length(q) - (R + ri)*0.5) - (R - ri)*0.5; }
  if(shape == 7){ return sdTri(q * vec2(1.0, -1.0), mix(s*sqrt(d / 1.7320508), 1.05*s, f)); }
  if(shape == 8){ return sdHex(q, mix(s*sqrt(d / 3.4641), 0.62*s, f)); }
  if(shape == 9){ return sdStar5(q * vec2(1.0, -1.0), mix(0.85*s*sqrt(d), 1.4*s, f), 0.45); }
  return length(q) - 0.5*sqrt(d)*s;
}
// AM screen: coverage 0..1 of ink at p. col = sampled colour of the winning cell
float dotScreen(vec2 p, float size, float angDeg, int shape, int src, out vec3 col){
  size = max(size, 1.0);
  vec2 c0 = u_res * 0.5;
  float a = radians(angDeg);
  vec2 q = rot(p - c0, -a);
  vec2 cell = floor(q / size);
  float lod = u_pointSample > 0.5 ? 0.0 : max(log2(size * 0.7), 0.0);
  float sd = 1e5; col = vec3(1.0);
  for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
    vec2 id = cell + vec2(float(i), float(j));
    vec2 ctr = (id + 0.5) * size;
    if(u_jitter > 0.0) ctr += (hash22(id + u_seed * 7.13) - 0.5) * u_jitter * size;
    vec4 s = sampLod(rot(ctr, a) + c0, lod);
    float d = srcDark(s, src);
    float e = d < 0.002 ? 1e5 : shapeSD(shape, q - ctr, d, size);
    if(e < sd){ sd = e; col = s.rgb; }
  }
  return clamp(0.5 - sd / max(u_soft, 0.05), 0.0, 1.0);
}
// how a coverage value is turned into pixels, shared by the mono screens
vec4 inkOut(float cov, vec4 base, vec3 col, int mode, vec3 ink, vec3 paper){
  vec4 o;
  if(mode == 1) o = vec4(mix(paper, clamp(mix(vec3(luma(col)), col, 1.25), 0.0, 1.0), cov), 1.0);
  else if(mode == 2) o = vec4(mix(base.rgb, ink, cov), 1.0);
  else if(mode == 3) o = vec4(ink, cov);
  else o = vec4(mix(paper, ink, cov), 1.0);
  o.a *= base.a;
  return o;
}
`;

// Shared torn-edge machinery: a ragged boundary profile along each image edge.
export const EDGE = `
uniform float u_inset;
uniform float u_rough;
uniform float u_scale;
uniform float u_jag;
uniform float u_micro;
uniform float u_period;
uniform int u_style;
uniform float u_top;
uniform float u_bottom;
uniform float u_left;
uniform float u_right;
uniform float u_rim;
uniform float u_fiber;

float edgeProfile(float t, float salt){
  salt += u_seed * 1.37;
  float per = max(u_period, 1.0);
  float b;
  if(u_style == 1){ float x = fract(t / per); b = (abs(x - 0.5) * 2.0 - 0.5) * u_rough; }
  else if(u_style == 2){ float x = (fract(t / per) - 0.5) * 2.0; b = (1.0 - sqrt(max(1.0 - x*x, 0.0)) - 0.5) * u_rough; }
  else if(u_style == 3){
    float g = t / per; float i = floor(g); float f = fract(g);
    b = (mix(hash12(vec2(i, salt)), hash12(vec2(i + 1.0, salt)), f) - 0.5) * u_rough;
  } else {
    float n = 0.0, a = 1.0, nn = 0.0, fr = 1.0 / max(u_scale, 1.0);
    for(int i = 0; i < 7; i++){ n += a * (vnoise(vec2(t * fr, salt + float(i) * 7.31)) - 0.5); nn += a; a *= u_jag; fr *= 2.13; }
    b = n / nn * 3.0 * u_rough;
  }
  b += (vnoise(vec2(t * 0.7, salt + 3.3)) - 0.5) * 2.0 * u_micro;
  return b;
}
// x: signed distance inside the sheet (>0 inside), y: position along edge, z: edge salt
vec3 edgeField(vec2 p){
  float s = 1e5, t = 0.0, id = 0.0;
  if(u_top > 0.5){ float v = p.y - u_inset - edgeProfile(p.x, 11.0); if(v < s){ s = v; t = p.x; id = 11.0; } }
  if(u_bottom > 0.5){ float v = (u_res.y - p.y) - u_inset - edgeProfile(p.x, 23.0); if(v < s){ s = v; t = p.x; id = 23.0; } }
  if(u_left > 0.5){ float v = p.x - u_inset - edgeProfile(p.y, 37.0); if(v < s){ s = v; t = p.y; id = 37.0; } }
  if(u_right > 0.5){ float v = (u_res.x - p.x) - u_inset - edgeProfile(p.y, 53.0); if(v < s){ s = v; t = p.y; id = 53.0; } }
  return vec3(s, t, id);
}
float rimFactor(float t, float salt){
  float n = 0.65 * vnoise(vec2(t / max(u_scale * 0.5, 2.0), salt + 4.1 + u_seed)) + 0.35 * vnoise(vec2(t / 7.0, salt + 9.7 + u_seed));
  return clamp((n - 0.18) * 2.2, 0.0, 2.0);
}
float fiberCov(float s, float t, float salt){
  if(s >= 0.0 || u_fiber <= 0.0) return 0.0;
  float len = u_fiber * (0.25 + 1.5 * vnoise(vec2(t * 0.3, salt + 1.7 + u_seed)));
  float h = vnoise(vec2(t * 0.85 + s * 0.3, salt + s * 0.02 + 5.0 + u_seed));
  float hair = smoothstep(0.62, 0.78, h);
  return hair * (1.0 - smoothstep(len * 0.5, len, -s)) * 0.95;
}
vec3 paperTex(vec2 p, vec3 base){
  float n = 0.5 * vnoise(p * 0.45 + u_seed) + 0.5 * vnoise(rot(p, 0.7) * vec2(0.06, 0.5) + 3.0);
  return base * (0.93 + 0.07 * n);
}
`;

// ---------------------------------------------------------------- halftones

export const HALFTONE = `
uniform float u_size; uniform float u_angle; uniform int u_shape; uniform int u_source; uniform int u_colorMode;
uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 base = samp(p); vec3 c;
  float cov = dotScreen(p, u_size, u_angle, u_shape, u_source, c);
  fragColor = inkOut(cov, base, c, u_colorMode, u_ink, u_paper);
}`;

export const CMYK = `
uniform float u_size; uniform float u_angC; uniform float u_angM; uniform float u_angY; uniform float u_angK;
uniform int u_shape; uniform float u_misreg; uniform float u_inkAlpha;
uniform vec3 u_inkC; uniform vec3 u_inkM; uniform vec3 u_inkY; uniform vec3 u_inkK; uniform vec3 u_paper;
vec2 mis(float k){ return (hash22(vec2(k * 3.7, u_seed + 1.0)) - 0.5) * 2.0 * u_misreg; }
void main(){
  vec2 p = P(); vec4 base = samp(p); vec3 t;
  float c = dotScreen(p + mis(1.0), u_size, u_angC, u_shape, 1, t);
  float m = dotScreen(p + mis(2.0), u_size, u_angM, u_shape, 2, t);
  float y = dotScreen(p + mis(3.0), u_size, u_angY, u_shape, 3, t);
  float k = dotScreen(p + mis(4.0), u_size, u_angK, u_shape, 4, t);
  vec3 col = u_paper;
  col *= mix(vec3(1.0), u_inkY, y * u_inkAlpha);
  col *= mix(vec3(1.0), u_inkM, m * u_inkAlpha);
  col *= mix(vec3(1.0), u_inkC, c * u_inkAlpha);
  col *= mix(vec3(1.0), u_inkK, k * u_inkAlpha);
  fragColor = vec4(col, base.a);
}`;

export const RISO = `
uniform float u_size; uniform float u_angA; uniform float u_angB; uniform int u_srcA; uniform int u_srcB;
uniform int u_shape; uniform int u_screen; uniform float u_misreg; uniform float u_grain;
uniform float u_densA; uniform float u_densB;
uniform vec3 u_inkA; uniform vec3 u_inkB; uniform vec3 u_paper;
float layerCov(vec2 p, float ang, int src, float salt){
  vec3 c;
  if(u_screen == 1){
    float g = max(u_size * 0.22, 1.0);
    float d = srcDark(sampLod(p, log2(g)), src);
    return step(hash12(floor(p / g) + salt + u_seed * 3.1), d);
  }
  return dotScreen(p, u_size, ang, u_shape, src, c);
}
void main(){
  vec2 p = P(); vec4 base = samp(p);
  vec2 oA = (hash22(vec2(3.1, u_seed)) - 0.5) * 2.0 * u_misreg;
  vec2 oB = (hash22(vec2(8.9, u_seed)) - 0.5) * 2.0 * u_misreg;
  float a = layerCov(p + oA, u_angA, u_srcA, 1.0) * u_densA;
  float b = layerCov(p + oB, u_angB, u_srcB, 7.0) * u_densB;
  float g1 = 1.0 - u_grain * (0.55 * vnoise(p * 0.08 + 3.0 + u_seed) + 0.45 * hash12(p + u_seed));
  float g2 = 1.0 - u_grain * (0.55 * vnoise(p * 0.08 + 9.0 + u_seed) + 0.45 * hash12(p * 1.3 + 5.0 + u_seed));
  vec3 col = u_paper * mix(vec3(1.0), u_inkB, clamp(b * g2, 0.0, 1.0)) * mix(vec3(1.0), u_inkA, clamp(a * g1, 0.0, 1.0));
  fragColor = vec4(col, base.a);
}`;

export const LINES = `
uniform float u_size; uniform float u_angle; uniform float u_waveAmp; uniform float u_waveLen; uniform float u_engrave;
uniform int u_source; uniform int u_colorMode; uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 base = samp(p);
  float size = max(u_size, 1.0);
  vec2 q = rot(p - u_res * 0.5, -radians(u_angle));
  vec4 s = sampLod(p, max(log2(size * 0.5), 0.0));
  float d = srcDark(s, u_source);
  q.y += u_waveAmp * sin(q.x * TAU / max(u_waveLen, 1.0));
  q.y += u_engrave * size * (d - 0.5) * 2.0;
  float dy = q.y - (floor(q.y / size) + 0.5) * size;
  float cov = d < 0.002 ? 0.0 : clamp(0.5 - (abs(dy) - 0.5 * size * d) / max(u_soft, 0.05), 0.0, 1.0);
  fragColor = inkOut(cov, base, s.rgb, u_colorMode, u_ink, u_paper);
}`;

export const CIRCLES = `
uniform float u_size; uniform float u_cx; uniform float u_cy; uniform float u_spiral; uniform float u_waveAmp;
uniform int u_source; uniform int u_colorMode; uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 base = samp(p);
  float size = max(u_size, 1.0);
  vec2 v = p - vec2(u_cx, u_cy) * u_res;
  float ang = atan(v.y, v.x);
  float r = length(v);
  if(u_spiral > 0.5) r += ang / TAU * size;
  r += u_waveAmp * sin(ang * 24.0);
  vec4 s = sampLod(p, max(log2(size * 0.5), 0.0));
  float d = srcDark(s, u_source);
  float dy = r - (floor(r / size) + 0.5) * size;
  float cov = d < 0.002 ? 0.0 : clamp(0.5 - (abs(dy) - 0.5 * size * d) / max(u_soft, 0.05), 0.0, 1.0);
  fragColor = inkOut(cov, base, s.rgb, u_colorMode, u_ink, u_paper);
}`;

export const CROSSHATCH = `
uniform float u_spacing; uniform float u_width; uniform float u_angle; uniform float u_layers;
uniform float u_wobble; uniform float u_breaks; uniform int u_colorMode; uniform vec3 u_ink; uniform vec3 u_paper;
float hatch(vec2 p, float ang, float d, float thr, float idx){
  float sp = max(u_spacing, 1.0);
  vec2 q = rot(p - u_res * 0.5, -radians(ang));
  q.y += u_wobble * sp * (vnoise(vec2(q.x / (sp * 8.0), idx * 17.3 + u_seed)) - 0.5) * 2.0;
  float row = floor(q.y / sp);
  float dy = q.y - (row + 0.5) * sp;
  float st = clamp((d - thr) / 0.2, 0.0, 1.0);
  if(u_breaks > 0.0){
    float br = vnoise(vec2(q.x / (sp * 4.0), row * 3.1 + idx * 11.0 + u_seed));
    st *= smoothstep(u_breaks - 0.1, u_breaks + 0.05, br);
  }
  if(st <= 0.0) return 0.0;
  float w = 0.5 * u_width * (0.35 + 0.65 * st);
  return clamp(0.5 - (abs(dy) - w) / max(u_soft, 0.05), 0.0, 1.0) * smoothstep(0.0, 0.25, st);
}
void main(){
  vec2 p = P(); vec4 base = samp(p);
  vec4 s = sampLod(p, max(log2(u_spacing * 0.6), 0.0));
  float d = srcDark(s, 0);
  float c = hatch(p, u_angle, d, 0.08, 0.0);
  if(u_layers > 1.5) c = max(c, hatch(p, u_angle + 90.0, d, 0.32, 1.0));
  if(u_layers > 2.5) c = max(c, hatch(p, u_angle - 45.0, d, 0.55, 2.0));
  if(u_layers > 3.5) c = max(c, hatch(p, u_angle + 45.0, d, 0.75, 3.0));
  fragColor = inkOut(c, base, s.rgb, u_colorMode, u_ink, u_paper);
}`;

export const STIPPLE = `
uniform float u_cell; uniform float u_dot; uniform float u_var; uniform float u_density;
uniform int u_colorMode; uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 base = samp(p);
  float cs = max(u_cell, 1.0);
  vec2 cell = floor(p / cs);
  float lod = max(log2(cs * 0.7), 0.0);
  float sd = 1e5; vec3 col = vec3(0.0);
  for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
    vec2 id = cell + vec2(float(i), float(j));
    vec2 ctr = (id + hash22(id + u_seed * 5.31)) * cs;
    vec4 s = sampLod(ctr, lod);
    float d = srcDark(s, 0);
    if(hash12(id * 1.37 + u_seed + 11.0) > pow(d, max(u_density, 0.05))) continue;
    float r = 0.5 * u_dot * (1.0 + u_var * (hash12(id + 23.0 + u_seed) - 0.5) * 1.6) * (0.75 + 0.5 * d);
    float e = length(p - ctr) - r;
    if(e < sd){ sd = e; col = s.rgb; }
  }
  fragColor = inkOut(clamp(0.5 - sd / max(u_soft, 0.05), 0.0, 1.0), base, col, u_colorMode, u_ink, u_paper);
}`;

// ---------------------------------------------------------------- dither & grain

export const DITHER = `
uniform int u_matrix; uniform int u_mode; uniform float u_pixel; uniform float u_levels; uniform float u_spread;
uniform vec3 u_ink; uniform vec3 u_paper;
float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float bayer16(vec2 a){ return bayer8(0.5 * a) * 0.25 + bayer2(a); }
float clusterT(vec2 a, float n){
  vec2 f = (mod(a, n) + 0.5) / n - 0.5;
  return clamp(1.0 - ((cos(TAU * f.x) + cos(TAU * f.y)) * 0.25 + 0.5) + bayer4(a) * 0.03, 0.0, 0.999);
}
float thr(vec2 a){
  if(u_matrix == 0) return bayer2(a) + 0.125;
  if(u_matrix == 1) return bayer4(a) + 0.03125;
  if(u_matrix == 2) return bayer8(a) + 0.0078125;
  if(u_matrix == 3) return bayer16(a) + 0.001953125;
  if(u_matrix == 4) return clusterT(a, 4.0);
  if(u_matrix == 5) return clusterT(a, 8.0);
  if(u_matrix == 6) return (mod(a.y, 4.0) + 0.5) / 4.0;
  if(u_matrix == 7) return (mod(a.x + a.y, 6.0) + 0.5) / 6.0;
  return hash12(a + u_seed * 3.3);
}
void main(){
  vec2 p = P(); vec4 base = samp(p);
  float px = max(u_pixel, 1.0);
  vec2 a = floor(p / px);
  vec4 s = sampLod((a + 0.5) * px, log2(px));
  float t = mix(0.5, thr(a), u_spread);
  float L = max(u_levels, 2.0) - 1.0;
  vec3 c = tone3(s.rgb);
  vec3 o;
  if(u_mode == 1) o = clamp(floor(c * L + t) / L, 0.0, 1.0);
  else { float q = clamp(floor(luma(c) * L + t) / L, 0.0, 1.0); o = mix(u_ink, u_paper, q); }
  fragColor = vec4(o, base.a);
}`;

export const MEZZOTINT = `
uniform int u_type; uniform int u_color; uniform float u_grain; uniform float u_angle;
uniform vec3 u_ink; uniform vec3 u_paper;
float field(vec2 p, float salt){
  float g = max(u_grain, 0.5);
  salt += u_seed * 3.17;
  if(u_type == 0) return hash12(floor(p / g) + salt);
  if(u_type == 1){ float n = 0.55 * hash12(floor(p / g) + salt) + 0.45 * vnoise(p / (g * 2.5) + salt); return clamp((n - 0.5) * 1.5 + 0.5, 0.0, 1.0); }
  if(u_type == 2){ float n = 0.6 * vnoise(p / (g * 2.0) + salt) + 0.4 * vnoise(p / (g * 0.8) + salt * 2.0); return clamp((n - 0.5) * 2.4 + 0.5, 0.0, 1.0); }
  vec2 q = rot(p, -radians(u_angle));
  float len = u_type == 3 ? 4.0 : (u_type == 4 ? 14.0 : 7.0);
  vec2 cg = q / vec2(g * len, g);
  cg.x += hash12(vec2(floor(cg.y), salt)) * 13.0;
  float h = hash12(floor(cg) + salt);
  if(u_type == 5){ float f = fract(cg.x); h = clamp(h + (abs(f - 0.5) - 0.25) * 0.7, 0.0, 1.0); }
  return h;
}
void main(){
  vec2 p = P(); vec4 s = samp(p);
  vec3 c = tone3(s.rgb);
  vec3 o;
  if(u_color == 1) o = vec3(step(field(p, 1.0), c.r), step(field(p, 2.0), c.g), step(field(p, 3.0), c.b));
  else o = mix(u_ink, u_paper, step(field(p, 1.0), luma(c)));
  fragColor = vec4(o, s.a);
}`;

// ---------------------------------------------------------------- torn & edges

export const TORN = `
uniform float u_shadow; uniform float u_shadowBlur; uniform float u_shadowX; uniform float u_shadowY; uniform float u_edgeShade;
uniform vec3 u_rimColor; uniform vec3 u_bg; uniform int u_bgMode;
void main(){
  vec2 p = P(); vec4 img = samp(p);
  vec3 e = edgeField(p);
  float s = e.x;
  float rimW = u_rim * rimFactor(e.y, e.z);
  float sImg = s - rimW;
  float a = max(clamp(s + 0.5, 0.0, 1.0), fiberCov(s, e.y, e.z)) * img.a;
  float ai = clamp(sImg + 0.5, 0.0, 1.0);
  vec3 col = mix(paperTex(p, u_rimColor), img.rgb, ai);
  col *= 1.0 - u_edgeShade * 0.22 * exp(-max(sImg, 0.0) / 2.5) * ai;
  float sh = 0.0;
  if(u_shadow > 0.0){
    vec2 q = p - vec2(u_shadowX, u_shadowY);
    float b = u_shadowBlur;
    sh = u_shadow * smoothstep(-b - 0.5, 0.5 + b * 0.3, edgeField(q).x)
       * smoothstep(-b - 0.5, 0.5 + b * 0.3, min(min(q.x, u_res.x - q.x), min(q.y, u_res.y - q.y)));
  }
  vec4 under = u_bgMode == 1 ? vec4(u_bg * (1.0 - sh), 1.0) : vec4(0.0, 0.0, 0.0, sh);
  fragColor = overC(vec4(col, a), under);
}`;

export const RIP = `
uniform float u_pos; uniform float u_angle; uniform float u_gap; uniform float u_drift; uniform float u_tilt;
uniform float u_rimA; uniform float u_rimB;
uniform float u_shadow; uniform float u_shadowBlur; uniform float u_shadowX; uniform float u_shadowY; uniform float u_edgeShade;
uniform vec3 u_rimColor; uniform vec3 u_bg; uniform int u_bgMode;
vec2 g_t; vec2 g_n; vec2 g_c;
void setupLine(){
  float a = radians(u_angle);
  g_t = vec2(cos(a), sin(a)); g_n = vec2(-g_t.y, g_t.x);
  float ext = abs(g_n.x) * u_res.x + abs(g_n.y) * u_res.y;
  g_c = u_res * 0.5 + g_n * (u_pos - 0.5) * ext;
}
vec2 pieceLocal(vec2 p, float side){
  vec2 l = p - g_c - g_n * side * u_gap * 0.5;
  if(side < 0.0){ l = rot(l, -radians(u_tilt)); l -= g_t * u_drift; }
  return l;
}
float pieceSD(vec2 l, float side){ return side * (dot(l, g_n) - edgeProfile(dot(l, g_t), 71.0)); }
vec4 piece(vec2 p, float side){
  vec2 l = pieceLocal(p, side); vec2 o = g_c + l;
  float t = dot(l, g_t);
  float sd = pieceSD(l, side);
  float salt = side > 0.0 ? 81.0 : 97.0;
  float rimW = (side > 0.0 ? u_rimA : u_rimB) * rimFactor(t, salt);
  vec4 img = samp(o);
  float a = max(clamp(sd + 0.5, 0.0, 1.0), fiberCov(sd, t, salt)) * inside(o) * img.a;
  float ai = clamp(sd - rimW + 0.5, 0.0, 1.0);
  vec3 col = mix(paperTex(o, u_rimColor), img.rgb, ai);
  col *= 1.0 - u_edgeShade * 0.22 * exp(-max(sd - rimW, 0.0) / 2.5) * ai;
  return vec4(col, a);
}
float pieceShadow(vec2 p, float side){
  vec2 l = pieceLocal(p, side); vec2 o = g_c + l;
  float b = u_shadowBlur;
  return smoothstep(-b - 0.5, 0.5 + b * 0.3, pieceSD(l, side))
       * smoothstep(-b - 0.5, 0.5 + b * 0.3, min(min(o.x, u_res.x - o.x), min(o.y, u_res.y - o.y)));
}
void main(){
  setupLine();
  vec2 p = P();
  vec2 so = vec2(u_shadowX, u_shadowY);
  float shA = u_shadow > 0.0 ? u_shadow * pieceShadow(p - so, 1.0) : 0.0;
  float shB = u_shadow > 0.0 ? u_shadow * pieceShadow(p - so, -1.0) : 0.0;
  float sh = max(shA, shB);
  vec4 r = u_bgMode == 1 ? vec4(u_bg * (1.0 - sh), 1.0) : vec4(0.0, 0.0, 0.0, sh);
  vec4 B = piece(p, -1.0);
  B.rgb *= 1.0 - shA * 0.6;
  r = overC(B, r);
  r = overC(piece(p, 1.0), r);
  fragColor = r;
}`;

export const BURN = `
uniform float u_burn; uniform vec3 u_char; uniform float u_ember; uniform vec3 u_emberColor; uniform float u_scorch;
uniform vec3 u_bg; uniform int u_bgMode;
void main(){
  vec2 p = P(); vec4 img = samp(p);
  vec3 e = edgeField(p); float s = e.x;
  float n = fbm(p / max(u_scale * 0.6, 2.0) + u_seed, 5, 0.55);
  float sb = s + (n - 0.5) * u_burn * 1.2;
  float burn = 1.0 - smoothstep(0.0, max(u_burn, 0.001), sb);
  vec3 col = img.rgb;
  vec3 brown = vec3(0.55, 0.36, 0.18);
  col = mix(col, col * brown * 1.25, smoothstep(0.0, 0.6, burn));
  col = mix(col, col * vec3(0.35, 0.2, 0.1), smoothstep(0.4, 0.8, burn));
  col = mix(col, u_char, smoothstep(0.7, 0.98, burn));
  float sc = smoothstep(0.6, 0.78, fbm(p / max(u_scale, 2.0) + 50.0 + u_seed, 5, 0.5)) * u_scorch;
  col = mix(col, col * brown * 0.7, sc);
  float em = exp(-max(s, 0.0) / 1.8) * u_ember * (0.5 + 0.8 * vnoise(p * 0.15 + u_seed)) * step(-0.5, s);
  col = clamp(col + u_emberColor * em, 0.0, 1.0);
  float a = clamp(s + 0.5, 0.0, 1.0) * img.a;
  vec4 under = u_bgMode == 1 ? vec4(u_bg, 1.0) : vec4(0.0);
  fragColor = overC(vec4(col, a), under);
}`;

export const TORN_CLASSIC = `
uniform float u_balance; uniform float u_smooth; uniform float u_rough; uniform float u_scale; uniform float u_sharp; uniform float u_grit;
uniform vec3 u_fg; uniform vec3 u_bg;
void main(){
  vec2 p = P(); vec4 base = samp(p);
  vec2 q = p / max(u_scale, 1.0) + u_seed;
  vec2 d = vec2(fbm(q, 5, 0.55), fbm(q + vec2(41.3, 17.9), 5, 0.55)) - 0.5;
  vec2 sp = p + d * 4.0 * u_rough;
  float l = luma(tone3(sampLod(sp, log2(max(u_smooth, 1.0))).rgb));
  float g = (vnoise(p * 0.7 + u_seed) - 0.5) * 0.25 * u_grit + (hash12(p + u_seed) - 0.5) * 0.08 * u_grit;
  float w = 0.5 / max(u_sharp, 1.0);
  float t = smoothstep(u_balance - w, u_balance + w, l + g);
  fragColor = vec4(mix(u_fg, u_bg, t), base.a);
}`;

export const DISTRESS = `
uniform float u_amount; uniform float u_scale; uniform float u_speckle; uniform float u_speckSize;
uniform float u_scratch; uniform float u_angle; uniform vec3 u_paper; uniform int u_target;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  float blot = fbm(p / max(u_scale, 1.0) + u_seed, 6, 0.6);
  float sp = hash12(floor(p / max(u_speckSize, 0.5)) + u_seed * 3.7);
  float v = blot + (sp - 0.5) * 0.35 * u_speckle;
  float th = mix(0.86, 0.36, u_amount);
  float wear = smoothstep(th, th + 0.02, v);
  vec2 q = rot(p, -radians(u_angle));
  float scr = smoothstep(mix(0.985, 0.86, u_scratch), mix(0.995, 0.9, u_scratch),
                vnoise(vec2(q.x / (u_scale * 3.0 + 1.0), q.y / 1.6) + u_seed));
  scr *= step(0.001, u_scratch) * smoothstep(0.4, 0.6, vnoise(q / (u_scale * 2.0 + 1.0) + 7.0 + u_seed));
  float m = clamp(max(wear, scr), 0.0, 1.0);
  fragColor = u_target == 1 ? vec4(s.rgb, s.a * (1.0 - m)) : vec4(mix(s.rgb, u_paper, m), s.a);
}`;

// ---------------------------------------------------------------- print & texture

export const PAPER = `
uniform vec3 u_tint; uniform float u_tintAmt; uniform float u_grain; uniform float u_fibers; uniform float u_blotch;
uniform float u_foldsV; uniform float u_foldsH; uniform float u_foldStrength;
float foldShade(float d, float span, float salt, float along){
  float side = sign(d) * exp(-abs(d) / (span * 0.035));
  float crease = exp(-abs(d) / 1.2) * (0.5 + 0.5 * vnoise(vec2(along * 0.08, salt)));
  return 1.0 + u_foldStrength * (0.09 * side - 0.28 * crease);
}
void main(){
  vec2 p = P(); vec4 s = samp(p);
  vec3 c = s.rgb * mix(vec3(1.0), u_tint, u_tintAmt);
  float g = 0.6 * vnoise(p * 0.9 + u_seed) + 0.4 * hash12(p + u_seed) - 0.5;
  c *= 1.0 + g * u_grain * 0.35;
  float f1 = smoothstep(0.82, 0.97, vnoise(rot(p, 0.6 + u_seed) * vec2(0.04, 0.7)));
  float f2 = smoothstep(0.84, 0.98, vnoise(rot(p, 2.1 + u_seed) * vec2(0.035, 0.6) + 20.0));
  c *= 1.0 - (f1 + f2) * u_fibers * 0.12;
  c *= 1.0 - u_blotch * (fbm(p / 220.0 + u_seed, 4, 0.5) - 0.5) * 0.5;
  for(int i = 1; i <= 4; i++){
    if(float(i) > u_foldsV + 0.01) break;
    float fx = u_res.x * float(i) / (floor(u_foldsV) + 1.0) + (vnoise(vec2(p.y * 0.01, float(i) + u_seed)) - 0.5) * 6.0;
    c *= foldShade(p.x - fx, u_res.x, float(i), p.y);
  }
  for(int i = 1; i <= 4; i++){
    if(float(i) > u_foldsH + 0.01) break;
    float fy = u_res.y * float(i) / (floor(u_foldsH) + 1.0) + (vnoise(vec2(p.x * 0.01, float(i) * 3.0 + u_seed)) - 0.5) * 6.0;
    c *= foldShade(p.y - fy, u_res.y, float(i) + 9.0, p.x);
  }
  fragColor = vec4(clamp(c, 0.0, 1.0), s.a);
}`;

export const SPREAD = `
uniform float u_radius; uniform float u_amount; uniform float u_rough;
void main(){
  vec2 p = P(); vec4 c = samp(p);
  vec3 mn = c.rgb;
  for(int i = 0; i < 12; i++){
    float a = float(i) / 12.0 * TAU;
    vec2 dir = vec2(cos(a), sin(a));
    float r = u_radius * (1.0 - u_rough * vnoise(p * 0.12 + float(i) * 3.7 + u_seed));
    mn = min(mn, samp(p + dir * r).rgb);
    mn = min(mn, samp(p + dir * r * 0.5).rgb);
  }
  fragColor = vec4(mix(c.rgb, mn, u_amount), c.a);
}`;

export const MISREG = `
uniform float u_amount; uniform float u_angle; uniform int u_mode;
void main(){
  vec2 p = P();
  vec2 o1, o2, o3;
  if(u_mode == 0){ vec2 d = vec2(cos(radians(u_angle)), sin(radians(u_angle))) * u_amount; o1 = d; o2 = vec2(0.0); o3 = -d; }
  else {
    o1 = (hash22(vec2(1.0, u_seed)) - 0.5) * 2.0 * u_amount;
    o2 = (hash22(vec2(2.0, u_seed)) - 0.5) * 2.0 * u_amount;
    o3 = (hash22(vec2(3.0, u_seed)) - 0.5) * 2.0 * u_amount;
  }
  vec4 r = samp(p + o1), g = samp(p + o2), b = samp(p + o3);
  fragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}`;

export const PHOTOCOPY = `
uniform float u_threshold; uniform float u_detail; uniform float u_toner; uniform float u_streaks; uniform float u_edgeDark;
uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  float l = luma(tone3(sampLod(p, 0.6).rgb));
  float bl = luma(tone3(sampLod(p, 4.0).rgb));
  l += (l - bl) * u_detail * 2.5;
  l += (hash12(p * 0.71 + u_seed) - 0.5) * 0.06;
  float ink = 1.0 - smoothstep(u_threshold - 0.035, u_threshold + 0.035, l);
  float spk = step(1.0 - u_toner * 0.012, hash12(floor(p / 1.6) + u_seed));
  float spk2 = smoothstep(0.93, 0.97, vnoise(p * 0.35 + u_seed * 2.0)) * step(0.6, vnoise(p * 0.01 + u_seed)) * u_toner;
  float st = smoothstep(0.8, 1.0, vnoise(vec2(p.x * 0.35, u_seed * 3.0))) * (0.6 + 0.4 * vnoise(vec2(p.x * 0.35, p.y * 0.004))) * u_streaks;
  vec2 uv = p / u_res;
  float m = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float ed = (1.0 - smoothstep(0.0, 0.12, m)) * u_edgeDark * (0.6 + 0.4 * vnoise(p * 0.03 + u_seed));
  float t = clamp(ink + spk + spk2 + st * 0.6 + step(hash12(p * 1.31 + u_seed), ed), 0.0, 1.0);
  fragColor = vec4(mix(u_paper, u_ink, t), s.a);
}`;

export const GRAIN = `
uniform float u_amount; uniform float u_gsize; uniform float u_mono;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  vec2 g = floor(p / max(u_gsize, 1.0));
  float n = hash12(g + u_seed * 3.1) - 0.5;
  vec3 nc = u_mono > 0.5 ? vec3(n) : vec3(n, hash12(g + 11.3 + u_seed) - 0.5, hash12(g + 27.1 + u_seed) - 0.5);
  float l = luma(s.rgb);
  float w = 4.0 * l * (1.0 - l) * 0.7 + 0.3;
  fragColor = vec4(clamp(s.rgb + nc * u_amount * w, 0.0, 1.0), s.a);
}`;

// ---------------------------------------------------------------- adjust

export const LEVELS = `
uniform float u_black; uniform float u_white; uniform float u_sat; uniform vec3 u_tint; uniform float u_tintAmt;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  vec3 c = clamp((s.rgb - u_black) / max(u_white - u_black, 0.001), 0.0, 1.0);
  c = tone3(c);
  float l = luma(c);
  c = clamp(mix(vec3(l), c, 1.0 + u_sat), 0.0, 1.0);
  vec3 tinted = mix(2.0 * l * u_tint, 1.0 - 2.0 * (1.0 - l) * (1.0 - u_tint), step(0.5, l));
  fragColor = vec4(mix(c, tinted, u_tintAmt), s.a);
}`;

export const POSTERIZE = `
uniform float u_levels;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  float L = max(u_levels, 2.0);
  fragColor = vec4(clamp(floor(tone3(s.rgb) * L) / (L - 1.0), 0.0, 1.0), s.a);
}`;

export const THRESHOLD = `
uniform float u_level; uniform float u_softness; uniform vec3 u_ink; uniform vec3 u_paper;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  float l = luma(tone3(s.rgb));
  float t = smoothstep(u_level - u_softness - 0.001, u_level + u_softness + 0.001, l);
  fragColor = vec4(mix(u_ink, u_paper, t), s.a);
}`;

export const BLUR = `
uniform float u_radius;
void main(){
  vec2 p = P();
  vec2 dir = u_pass == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  float r = max(u_radius, 0.01);
  float sigma = r * 0.5;
  float stepPx = max(1.0, r / 16.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for(int i = -32; i <= 32; i++){
    float x = float(i) * stepPx;
    if(abs(x) > r * 1.5) continue;
    float w = exp(-x * x / (2.0 * sigma * sigma));
    vec4 s = samp(p + dir * x);
    acc += vec4(s.rgb * s.a, s.a) * w; ws += w;
  }
  acc /= ws;
  fragColor = vec4(acc.a > 0.0 ? acc.rgb / acc.a : vec3(0.0), acc.a);
}`;

export const SHARPEN = `
uniform float u_amount; uniform float u_radius;
void main(){
  vec2 p = P(); vec4 s = samp(p);
  vec3 b = vec3(0.0);
  for(int i = 0; i < 8; i++){
    float a = float(i) / 8.0 * TAU;
    vec2 d = vec2(cos(a), sin(a)) * u_radius;
    b += samp(p + d).rgb + samp(p + d * 0.5).rgb;
  }
  b /= 16.0;
  fragColor = vec4(clamp(s.rgb + (s.rgb - b) * u_amount, 0.0, 1.0), s.a);
}`;

export const PIXELATE = `
uniform float u_cell;
void main(){
  vec2 p = P(); float c = max(u_cell, 1.0);
  vec2 a = (floor(p / c) + 0.5) * c;
  fragColor = sampLod(a, log2(c));
}`;

// ---------------------------------------------------------------- engine internals

export const BLEND = `
uniform sampler2D u_base; uniform float u_opacity; uniform int u_mode;
vec3 blendFn(vec3 b, vec3 e, int m){
  if(m == 2) return b * e;
  if(m == 3) return 1.0 - (1.0 - b) * (1.0 - e);
  if(m == 4) return mix(2.0 * b * e, 1.0 - 2.0 * (1.0 - b) * (1.0 - e), step(0.5, b));
  if(m == 5) return mix(2.0 * b * e + b * b * (1.0 - 2.0 * e), sqrt(b) * (2.0 * e - 1.0) + 2.0 * b * (1.0 - e), step(0.5, e));
  if(m == 6) return min(b, e);
  if(m == 7) return max(b, e);
  if(m == 8) return abs(b - e);
  return e;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 b = texture(u_base, uv), e = texture(u_tex, uv);
  vec4 R;
  if(u_mode == 0) R = e;
  else R = overC(vec4(mix(e.rgb, blendFn(b.rgb, e.rgb, u_mode), b.a), e.a), b);
  vec4 B = vec4(b.rgb * b.a, b.a), E = vec4(R.rgb * R.a, R.a);
  vec4 M = mix(B, E, u_opacity);
  fragColor = vec4(M.a > 0.0 ? M.rgb / M.a : vec3(0.0), M.a);
}`;

export const DISPLAY = `
uniform sampler2D u_src; uniform float u_split;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  fragColor = gl_FragCoord.x < u_split ? texture(u_src, uv) : texture(u_tex, uv);
}`;
