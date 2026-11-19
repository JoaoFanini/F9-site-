// Shaders do mundo da Sinal. Tudo sai em branco puro sobre preto (1-bit): sem cinza, sem alfa parcial,
// exceto a borda suave das letras sólidas do título.
// Convenção: coordenadas de tela com origem no canto de cima à esquerda, em px de dispositivo.

const COMMON = /* glsl */ `
float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// ---------- quad genérico (imagens, título sólido, brilhos) ----------
export const QUAD_VS = /* glsl */ `#version 300 es
layout(location=0) in vec2 a_p;   // 0..1
uniform vec2 u_res;               // px de dispositivo do canvas
uniform vec4 u_rect;              // x, y, w, h em px de dispositivo (topo à esquerda)
void main(){
  vec2 p = u_rect.xy + a_p * u_rect.zw;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

// Imagem em tons de cinza → dither ordenado 1-bit em células quadradas presas à imagem (o padrão não
// "nada" quando ela se move). O lado de onde o fluxo chega se desfaz em pontos deslocados contra o fluxo;
// a entrada (u_form) traz cada célula de longe, ao longo do fluxo, com atraso aleatório.
export const IMAGE_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_cell;
uniform sampler2D u_tex;
uniform float u_form;
uniform vec2 u_dir;      // direção do fluxo nesta imagem (unitária, y para baixo)
uniform float u_dis;     // quanto o lado de entrada se desfaz
uniform vec3 u_tone;     // piso, ganho, gama
uniform vec2 u_mouse;    // px de dispositivo
uniform float u_mr;      // raio da lente do cursor (0 = sem)
uniform float u_seed;
uniform float u_edge;    // margem de esmaecimento nas bordas (uv)
uniform float u_fadeB;
uniform float u_travel;  // quanto a entrada traz as células de longe   // esmaecimento extra embaixo (o pulso que sai da seção)
out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 local = p - u_rect.xy;
  vec2 cell = floor(local / u_cell);
  vec2 c = (cell + 0.5) * u_cell;
  float r = hash(cell + u_seed);
  // lente do cursor: o conteúdo abre espaço em volta do ponteiro
  vec2 cm = u_rect.xy + c - u_mouse;
  float dm = length(cm);
  float push = u_mr > 0.0 ? smoothstep(u_mr, 0.0, dm) : 0.0;
  vec2 sc = c - (dm > 0.001 ? cm / dm : vec2(0.0)) * push * push * u_mr * 0.32;
  vec2 uv = sc / u_rect.zw;
  // lado de entrada do fluxo: -1 (saída) .. 1 (entrada)
  float side = dot(uv - 0.5, -u_dir) * 2.0;
  float D = smoothstep(-0.1, 0.95, side) * u_dis;
  float delay = r * 0.55 + (1.0 - clamp(side * 0.5 + 0.5, 0.0, 1.0)) * 0.25;
  float k = smoothstep(delay, delay + 0.3, u_form);
  vec2 off = u_dir * (D * D * (0.04 + r * 0.22) + (1.0 - k) * (0.18 + r * 0.5) * u_travel);
  vec2 suv = uv - off;
  float lum = 0.0;
  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) lum = texture(u_tex, suv).r;
  vec2 e = smoothstep(vec2(0.0), vec2(u_edge), uv) * smoothstep(vec2(0.0), vec2(u_edge), 1.0 - uv);
  lum *= e.x * e.y;
  if (u_fadeB > 0.0) lum *= smoothstep(1.0, 1.0 - u_fadeB, uv.y);
  lum = pow(clamp((lum - u_tone.x) / (1.0 - u_tone.x) * u_tone.y, 0.0, 1.0), u_tone.z);
  lum *= (1.0 - D * 0.72) * step(0.001, k);
  if (bayer8(cell) + 0.0078 >= lum) discard;
  o = vec4(0.722, 0.949, 0.831, 1.0);
}`;

// Brilho dithered: halo em volta da esfera (cresce no pulso); com u_core, o disco também
// (cabeça do sinal e a luz do fechamento, que não têm disco na imagem).
export const GLOW_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec2 u_res;
uniform vec4 u_rect;
uniform vec2 u_c;       // centro, px de dispositivo (inteiro)
uniform float u_R;      // raio do disco, px de dispositivo
uniform float u_cell;
uniform float u_int;    // intensidade
uniform float u_ring;   // fase da onda 0..1
uniform float u_core;   // preenche o disco
uniform float u_halo;   // força do halo
out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 cell = floor((p - u_c) / u_cell);
  vec2 cc = (cell + 0.5) * u_cell;
  float d = length(cc) / u_R;
  float lum = d < 1.0 ? u_core * (1.0 - 0.35 * smoothstep(0.5, 1.0, d)) : exp(-(d - 1.0) * 3.4) * u_halo;
  lum *= u_int;
  if (bayer8(cell) + 0.0078 >= lum) discard;
  o = vec4(0.722, 0.949, 0.831, 1.0);
}`;

// Mostrador do loader: 64 marcas em volta da esfera, em células 1-bit. As acesas vão até o progresso real
// do download; as apagadas ficam como pontilhado ralo. Na saída o anel abre (u_rad cresce) e se desfaz (u_a).
export const DIAL_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec2 u_res;
uniform vec4 u_rect;
uniform vec2 u_c;       // centro, px de dispositivo (inteiro)
uniform float u_R;      // raio da esfera, px de dispositivo
uniform float u_cell;
uniform float u_prog;   // 0..1
uniform float u_rad;    // raio do anel, em raios da esfera
uniform float u_a;      // intensidade geral
out vec4 o;
const float PI2 = 6.2831853;
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 cell = floor((p - u_c) / u_cell);
  vec2 cc = (cell + 0.5) * u_cell;
  float d = length(cc) / u_R;
  float f = fract(atan(cc.x, -cc.y) / PI2 + 1.0);      // 0 no topo, horário
  float k = f * 64.0, idx = floor(k);
  bool major = mod(idx, 8.0) < 0.5;
  float th = major ? 0.24 : 0.13;
  float r0 = u_rad - (major ? 0.04 : 0.0);
  if (d < r0 || d > r0 + th) discard;
  if (fract(k) > 0.42) discard;                        // vão entre marcas
  float lit = clamp(u_prog * 64.0 - idx, 0.0, 1.0);    // a marca corrente acende em pontilhado
  float lum = mix(0.16, 1.0, lit) * u_a;
  if (bayer8(cell) + 0.0078 >= lum) discard;
  o = vec4(0.722, 0.949, 0.831, 1.0);
}`;

// Título sólido: só as células cuja ordem de solidificação (S) já passou; o resto é feito de pontos.
export const TITLE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_cell;
uniform float u_solid;
uniform sampler2D u_cov;   // cobertura das letras, px de dispositivo
uniform sampler2D u_S;     // ordem de solidificação por célula (0..1, >=1 nunca)
out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 local = p - u_rect.xy;
  ivec2 cell = ivec2(floor(local / u_cell));
  float S = texelFetch(u_S, cell, 0).r * 2.0;
  if (u_solid <= S) discard;
  float a = texelFetch(u_cov, ivec2(floor(local)), 0).r;
  if (a < 0.004) discard;
  o = vec4(a);
}`;

// ---------- partículas ----------
// tipo 0: estrelas (fundo, lentas), 1: marcas de primeiro plano (rápidas, nas bordas),
// 2: explosão que sai da esfera, 3: o fluxo que desce a página pelo caminho.
export const POINTS_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec4 a_r;
layout(location=1) in float a_k;
uniform vec2 u_vp;        // tela em px css
uniform vec2 u_res;
uniform float u_dpr, u_cell, u_time, u_scroll;
uniform vec2 u_mouse;     // px css de tela
uniform vec2 u_mpar;      // deslocamento do mouse para a profundidade 1 (px css)
uniform vec2 u_sph;       // centro da esfera (px css do documento)
uniform float u_sphR;
uniform vec2 u_bdir;
uniform float u_blen, u_reach, u_stars, u_pulse, u_fg;
uniform sampler2D u_path; // linha 0: x, y, nx, ny; linha 1: largura
uniform int u_pn;
uniform float u_plen, u_head;
uniform vec4 u_rects[32];
uniform int u_nr;
out float v_shape;
#define HIDE { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
float gauss(float a, float b){ return sqrt(-2.0 * log(max(a, 1e-4))) * cos(6.2831853 * b); }
vec2 depth(vec2 doc, float f){
  float y = doc.y - u_scroll - (f - 1.0) * (u_scroll - (doc.y - u_vp.y * 0.5));
  return vec2(doc.x, y);
}
void main(){
  int k = int(a_k + 0.5);
  vec2 p; float size = 1.0; v_shape = 0.0;
  if (k == 0) {
    if (a_r.w > u_stars) HIDE
    float f = 0.12 + a_r.z * 0.3;
    float H = u_vp.y * 1.5;
    p = vec2(a_r.x * u_vp.x, mod(a_r.y * H - u_scroll * f, H) - u_vp.y * 0.25) + u_mpar * (0.15 + a_r.z * 0.35);
    size = fract(a_r.w * 17.3) > 0.97 ? 2.0 : 1.0;
  } else if (k == 1) {
    if (a_r.w > u_fg) HIDE
    float side = a_r.x < 0.5 ? a_r.x * 2.0 * 0.12 + 0.01 : 0.99 - (a_r.x - 0.5) * 2.0 * 0.12;
    float f = 1.7 + a_r.y * 0.6;
    float H = u_vp.y * 2.4;
    p = vec2(side * u_vp.x, mod(a_r.z * H - u_scroll * f, H) - u_vp.y * 0.7) + u_mpar * f * 1.5;
    size = 4.0 + floor(fract(a_r.w * 31.7) * 4.0) * 2.0;
    v_shape = 1.0;
  } else if (k == 2) {
    float t = fract(a_r.x + u_time * (0.035 + 0.04 * a_r.y));
    float g1 = gauss(fract(a_r.z * 91.7), a_r.w);
    float g2 = gauss(fract(a_r.w * 37.3), fract(a_r.z * 5.3));
    float reach = 0.35 + 0.65 * fract(a_r.y * 17.1);
    float dist = u_sphR * 0.8 + pow(t, 1.5) * u_blen * reach;
    float ang = g1 * 0.13;
    vec2 d = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * u_bdir;
    vec2 n = vec2(-d.y, d.x);
    vec2 doc = u_sph + d * dist + n * g2 * (u_sphR * 0.35 + dist * 0.07);
    doc += d * u_pulse * 30.0 * (1.0 - t);
    if (dist > u_sphR + u_reach * u_blen) HIDE
    if (t > 0.8 + 0.2 * fract(a_r.y * 7.7)) HIDE
    float f = 1.0 + (a_r.z - 0.5) * 0.3;
    p = depth(doc, f) + u_mpar * f;
    size = a_r.z > 0.9 ? (a_r.z > 0.985 ? 3.0 : 2.0) : 1.0;
  } else {
    float s = mod(a_r.x * u_plen + u_time * (34.0 + 46.0 * a_r.y), u_plen);
    if (s > u_head - 320.0 * a_r.z) HIDE
    float fi = s / u_plen * float(u_pn - 1);
    int i0 = int(floor(fi)); float fr = fi - float(i0);
    int i1 = min(i0 + 1, u_pn - 1);
    vec4 A = texelFetch(u_path, ivec2(i0, 0), 0), B = texelFetch(u_path, ivec2(i1, 0), 0);
    float w = mix(texelFetch(u_path, ivec2(i0, 1), 0).x, texelFetch(u_path, ivec2(i1, 1), 0).x, fr);
    vec2 pos = mix(A.xy, B.xy, fr);
    vec2 n = normalize(mix(A.zw, B.zw, fr) + 1e-5);
    float g = gauss(fract(a_r.z * 53.1), a_r.w);
    float lat = g * w + sin(u_time * 0.5 + a_r.y * 40.0) * 6.0;
    vec2 doc = pos + n * lat;
    float f = 0.88 + a_r.w * 0.3;
    p = depth(doc, f) + u_mpar * f;
    size = fract(a_r.y * 13.3) > 0.9 ? 2.0 : 1.0;
  }
  // o cursor afasta os pontos
  vec2 dm = p - u_mouse;
  float dl = length(dm);
  p += dm / max(dl, 1.0) * 26.0 * smoothstep(95.0, 0.0, dl);
  if (p.y < -60.0 || p.y > u_vp.y + 60.0 || p.x < -60.0 || p.x > u_vp.x + 60.0) HIDE
  // texto: os pontos rareiam perto e somem por cima
  float edge = 30.0 * fract(a_r.w * 7.77 + a_r.x);
  for (int i = 0; i < 32; i++) {
    if (i >= u_nr) break;
    vec4 R = u_rects[i];
    vec2 q = max(R.xy - p, p - R.zw);
    if (max(q.x, q.y) < edge) HIDE
  }
  float sz = size * u_cell;
  vec2 c = floor(p * u_dpr) + mod(sz, 2.0) * 0.5;
  gl_Position = vec4(c.x / u_res.x * 2.0 - 1.0, 1.0 - c.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = sz;
}`;

export const POINTS_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_shape;
out vec4 o;
void main(){
  if (v_shape > 0.5) {
    vec2 c = gl_PointCoord;
    bool a = c.x < 0.5 && c.y < 0.5, b = c.x >= 0.5 && c.y >= 0.5;
    if (!(a || b)) discard;
  }
  o = vec4(0.722, 0.949, 0.831, 1.0);
}`;

// Pontos do título: cada célula de tinta sai da esfera, arqueia pela direção da explosão e pousa no
// lugar. Depois as de fora viram letra sólida (TITLE_FS) e as de dentro ficam como dither que respira.
export const TITLE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec4 a_t;   // célula x, y; S; D
layout(location=1) in vec4 a_u;   // cobertura, bayer, aleatório, atraso
uniform vec2 u_res;
uniform vec2 u_org;               // origem do título, px de dispositivo (inteiro)
uniform vec2 u_sph;               // esfera em px de dispositivo de tela
uniform vec2 u_arc, u_drift;     // para onde o voo arqueia; para onde os pontos soltos respiram
uniform float u_spread, u_amp;    // espalhamento da origem (px de dispositivo); amplitude da respiração
uniform float u_cell, u_dpr, u_tT, u_solid, u_time, u_pulse;
#define HIDE { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
void main(){
  float S = a_t.z, D = a_t.w;
  float cov = a_u.x, bay = a_u.y, r = a_u.z, delay = a_u.w;
  if (u_solid > S) HIDE
  float th = mix(1.01, cov * (1.0 - D * 0.86), u_solid);
  if (bay >= th) HIDE
  float k = clamp((u_tT - delay) / 1.25, 0.0, 1.0);
  if (k <= 0.0) HIDE
  float e = 1.0 - pow(1.0 - k, 4.0);
  vec2 tgt = u_org + (a_t.xy + 0.5) * u_cell;
  vec2 s0 = u_sph + (vec2(r, fract(r * 13.17)) - 0.5) * vec2(u_spread, u_spread * 0.25);
  vec2 ctrl = mix(s0, tgt, 0.45) + u_arc * length(tgt - s0) * 0.38;
  vec2 pos = mix(mix(s0, ctrl, e), mix(ctrl, tgt, e), e);
  float amp = D * D * (12.0 + 30.0 * r) * u_solid * u_amp;
  pos += u_drift * u_dpr * (amp * (0.5 - 0.5 * cos(u_time * 0.7 + r * 6.2831)) + u_pulse * D * D * 22.0);
  vec2 c = floor(pos - u_cell * 0.5) + u_cell * 0.5;
  gl_Position = vec4(c.x / u_res.x * 2.0 - 1.0, 1.0 - c.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_cell;
}`;

export const POINTS_SOLID_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(0.722, 0.949, 0.831, 1.0); }`;
