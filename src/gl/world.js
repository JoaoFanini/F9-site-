// O mundo da Sinal: um canvas WebGL fixo atrás da página, em 1-bit (branco sobre preto).
// - Imagens-fonte em tons de cinza (Codex) viram dither ordenado em código, presas a elementos do DOM
//   ([data-obj]); cada uma tem uma profundidade (f) e se desfaz do lado de onde o fluxo chega.
// - A esfera nas mãos explode em pontos pela diagonal; um fluxo de partículas sai dela e desce a página
//   por um caminho que passa pelos objetos de cada seção ([data-way]). A cabeça do fluxo (o "sinal")
//   segue o scroll por uma curva monotônica que casa cada seção com o seu objeto ([data-anchor]).
// - Os pontos somem perto de texto (retângulos de [KEEP]) para o fluxo nunca atravessar um título.
// - O título "Faça existir" é desenhado aqui (o h1 continua no HTML, transparente, para leitores de tela).
import { QUAD_VS, IMAGE_FS, GLOW_FS, TITLE_FS, POINTS_VS, POINTS_FS, TITLE_VS, POINTS_SOLID_FS, DIAL_FS } from './shaders.js';
import { program, texture, bayer8, smoothstep } from './gl.js';
import IMG from './imagens.json';
import { gsap } from 'gsap';

const CELL_CSS = 2;
const PATH_N = 512;
// objetos que o fluxo contorna (os pontos rareiam e somem sobre eles, como sobre o texto)
const AVOID_OBJ = new Set(['baleia', 'olho', 'camera', 'marca', 'lua']);
const KEEP = '.eyebrow, .h2, .lead, .prompt, .step, .cap, .servico__txt, .obra, .stat, .plan, .final__title, .final__ctas, .hero__foot > *, .hero__scroll, .foot__cols, .foot__word, .foot__legal';

// tom: [piso, ganho, gama]; dis: quanto o lado de entrada se desfaz; f: profundidade; edge: esmaecimento
const CONF = {
  maos: { src: '/img/maos.webp', tone: [0.03, 1.0, 1.3], dis: 0.28, edge: 0.03, f: 1, travel: 0.35 },
  baleia: { src: '/img/baleia.webp', tone: [0.06, 1.12, 1.1], dis: 0.45, edge: 0.07, f: 0.9 },
  olho: { src: '/img/o-olho.webp', tone: [0.05, 1.15, 1.05], dis: 0.55, edge: 0.1, f: 0.94 },
  camera: { src: '/img/o-camera.webp', tone: [0.03, 1.4, 1.0], dis: 0.4, edge: 0.08, f: 0.94 },
  marca: { src: 'marca', tone: [0.0, 1.0, 1.0], dis: 0.55, edge: 0.04, f: 0.94 },
  perfume: { src: '/img/t-perfume.webp', tone: [0.05, 1.2, 1.0], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  perfil: { src: '/img/t-perfil.webp', tone: [0.05, 1.2, 1.0], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  casa: { src: '/img/t-casa.webp', tone: [0.04, 1.3, 0.95], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  tenis: { src: '/img/t-tenis.webp', tone: [0.05, 1.2, 1.0], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  'agua-viva': { src: '/img/t-agua-viva.webp', tone: [0.05, 1.15, 1.0], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  cavalo: { src: '/img/t-cavalo.webp', tone: [0.05, 1.1, 1.05], dis: 0.3, edge: 0.06, f: 1, fit: 'contain' },
  lua: { src: '/img/o-lua.webp', tone: [0.05, 1.2, 1.0], dis: 0.8, edge: 0.08, f: 0.82 },
  fechamento: { src: '/img/fechamento.webp', tone: [0.03, 1.25, 1.05], dis: 0.2, edge: 0.04, f: 1, fadeB: 0.3 },
};
const aspect = (k) => {
  if (k === 'marca') return 1;
  const m = IMG[CONF[k].src.replace('/img/', '').replace('.webp', '')];
  return m.w / m.h;
};

export function createWorld({ reduced = false, src = (u) => u } = {}) {
  const canvas = document.querySelector('canvas.world');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;

  const pQuad = program(gl, QUAD_VS, IMAGE_FS);
  const pGlow = program(gl, QUAD_VS, GLOW_FS);
  const pTitle = program(gl, QUAD_VS, TITLE_FS);
  const pPts = program(gl, POINTS_VS, POINTS_FS);
  const pTpts = program(gl, TITLE_VS, POINTS_SOLID_FS);
  const pDial = program(gl, QUAD_VS, DIAL_FS);

  // quad unitário
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const mobile0 = matchMedia('(max-width: 760px)').matches;
  // ---------- partículas (buffer fixo; o caminho muda por uniform/textura) ----------
  const COUNT = mobile0
    ? { stars: 150, fg: 12, burst: 5600, stream: 24000 }
    : { stars: 300, fg: 22, burst: 12000, stream: 54000 };
  const total = COUNT.stars + COUNT.fg + COUNT.burst + COUNT.stream;
  const rnd = new Float32Array(total * 4);
  const kind = new Float32Array(total);
  let n = 0;
  for (const [k, c] of [[0, COUNT.stars], [1, COUNT.fg], [2, COUNT.burst], [3, COUNT.stream]]) {
    for (let i = 0; i < c; i++, n++) {
      for (let j = 0; j < 4; j++) rnd[n * 4 + j] = Math.random();
      kind[n] = k;
    }
  }
  // marcas de primeiro plano: espalhadas por igual na altura (não em bolo)
  for (let i = 0; i < COUNT.fg; i++) rnd[(COUNT.stars + i) * 4 + 2] = (i + Math.random() * 0.6) / COUNT.fg;
  const ptsVao = gl.createVertexArray();
  gl.bindVertexArray(ptsVao);
  const rb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rb);
  gl.bufferData(gl.ARRAY_BUFFER, rnd, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  const kb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, kb);
  gl.bufferData(gl.ARRAY_BUFFER, kind, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const pathTex = gl.createTexture();
  const pathData = new Float32Array(PATH_N * 2 * 4);

  // ---------- objetos ----------
  const objs = [...document.querySelectorAll('[data-obj]')].map((el) => {
    const key = el.dataset.obj;
    const c = CONF[key];
    if (!c.fit && key !== 'maos') el.style.aspectRatio = String(aspect(key));
    return { el, key, c, ar: aspect(key), tex: null, loading: false, form: 0, revealed: false, rect: null, dir: [0.6, 0.8], seed: Math.random() * 100 };
  });
  const byKey = Object.fromEntries(objs.map((o) => [o.key, o]));
  function load(o) {
    if (o.loading) return o.ready;
    o.loading = true;
    if (o.c.src === 'marca') { o.tex = texture(gl, marcaCanvas()); o.ready = Promise.resolve(); return o.ready; }
    const img = new Image();
    img.decoding = 'async';
    // o que o loader baixa vem dele (URL do Blob, esperando o download em curso): o mesmo arquivo nunca desce duas vezes
    o.ready = Promise.resolve(src(o.c.src)).then((u) => { img.src = u; return img.decode(); }).then(() => { o.tex = texture(gl, img); }).catch(() => {});
    return o.ready;
  }

  // ---------- estado ----------
  const st = { stars: 0, reach: 0, tT: -1, solid: 0, glow: 0, pulse: 0, ring: 0, pulseOn: false, headGlow: 0, fg: 0 };
  const dial = { prog: 0, rad: 1.55, a: 0 }; // mostrador do loader (motion/loader.js)
  let vw = 0, vh = 0, dpr = 1, cell = 2, mobile = false, cw = 0, ch = 0;
  let sph = { x: 0, y: 0, r: 40 }, bdir = [-0.64, -0.77], blen = 900;
  let plen = 1, pathPts = [], anchors = [], keep = [], spark = null;
  const mouse = { x: -9999, y: -9999, tx: 0, ty: 0, px: 0, py: 0 };
  const types = {};
  const ft = { tT: -1, solid: 0, played: false }; // estado do wordmark do rodapé
  const time0 = performance.now();
  let lastW = 0, footKey = '';

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  function layoutHands() {
    const o = byKey.maos;
    const e = IMG.maos.esfera;
    const hero = document.querySelector('.hero');
    const H = hero.offsetHeight;
    let w, tx, ty;
    if (mobile) { w = Math.max(vw * 2.3, H * 1.05); tx = vw * 0.5; ty = H * 0.585; }
    else { w = Math.max(vw * 1.1, H * 1.95); tx = vw * 0.565; ty = H * 0.6; }
    const h = w / o.ar;
    Object.assign(o.el.style, { left: tx - e.u * w + 'px', top: ty - e.v * h + 'px', width: w + 'px', height: h + 'px' });
  }

  function measure(force = false) {
    vw = document.documentElement.clientWidth;
    vh = window.innerHeight;
    mobile = vw < 760;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cell = Math.max(1, Math.round((mobile ? 1.67 : CELL_CSS) * dpr));
    cw = Math.round(canvas.clientWidth * dpr);
    ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }

    layoutHands();
    for (const o of objs) {
      let r = docRect(o.el);
      if (o.c.fit === 'contain') {
        const ar = o.ar, w = Math.min(r.w, r.h * ar) * 0.9, h = w / ar;
        r = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
      }
      o.rect = r;
    }
    const m = byKey.maos.rect, e = IMG.maos.esfera;
    sph = { x: m.x + e.u * m.w, y: m.y + e.v * m.h, r: e.r * m.w };
    // explosão: da esfera para o alto à esquerda
    const target = mobile ? [-vw * 0.05, document.querySelector('.hero').offsetHeight * 0.3] : [vw * 0.26, -vh * 0.02];
    const dx = target[0] - sph.x, dy = target[1] - sph.y, dl = Math.hypot(dx, dy);
    bdir = [dx / dl, dy / dl];
    blen = dl * 1.08;
    const f = byKey.fechamento.rect, l = IMG.fechamento.luz;
    spark = { x: f.x + l.u * f.w, y: f.y + l.v * f.h };

    buildPath();
    // posição de layout (sem transform): os textos ainda podem estar no meio da entrada
    keep = [...document.querySelectorAll(KEEP)].map((el) => {
      let x = 0, y = 0, e = el;
      while (e) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
      return [x, y, x + el.offsetWidth, y + el.offsetHeight];
    });
    if (force || vw !== lastW || !types.hero) buildType('hero');
    const fwEl = document.querySelector('[data-foot-word]');
    const fkey = fwEl ? `${vw}|${dpr}|${Math.round(docRect(fwEl).y)}|${fwEl.offsetHeight}` : '';
    if (fkey !== footKey) { footKey = fkey; buildType('foot'); }
    lastW = vw;
  }

  // ---------- caminho do fluxo ----------
  function buildPath() {
    const wps = [{ x: sph.x, y: sph.y, w: sph.r * 0.45, el: null }];
    // sai da esfera para baixo, por fora do título e dos botões
    wps.push({ x: mobile ? vw * 0.82 : vw * 0.9, y: sph.y + vh * (mobile ? 0.42 : 0.5), w: mobile ? 26 : 40 });
    document.querySelectorAll('[data-way]').forEach((el) => {
      const o = objs.find((q) => q.el === el);
      const r = o ? o.rect : docRect(el);
      const k = parseFloat(el.dataset.w || '0.2');
      wps.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: Math.max(18, k * r.w), el, anchor: 'anchor' in el.dataset, obj: o });
    });
    wps.push({ x: spark.x, y: spark.y, w: 4, el: byKey.fechamento.el, anchor: true });
    // Catmull-Rom denso
    const dense = [];
    for (let i = 0; i < wps.length - 1; i++) {
      const p0 = wps[i - 1] || wps[i], p1 = wps[i], p2 = wps[i + 1], p3 = wps[i + 2] || p2;
      const steps = 40;
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * smoothstep(0, 1, t), wp: s === 0 ? i : -1 });
      }
    }
    const last = wps[wps.length - 1];
    dense.push({ x: last.x, y: last.y, w: last.w, wp: wps.length - 1 });
    let L = 0;
    dense.forEach((p, i) => { if (i) L += Math.hypot(p.x - dense[i - 1].x, p.y - dense[i - 1].y); p.l = L; });
    plen = L;
    wps.forEach((w, i) => { w.l = dense.find((p) => p.wp === i).l; });
    // reamostra por comprimento
    pathPts = [];
    let j = 0;
    for (let i = 0; i < PATH_N; i++) {
      const l = (L * i) / (PATH_N - 1);
      while (j < dense.length - 2 && dense[j + 1].l < l) j++;
      const a = dense[j], b = dense[j + 1];
      const t = (l - a.l) / (b.l - a.l || 1);
      pathPts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t });
    }
    pathPts.forEach((p, i) => {
      const a = pathPts[Math.max(0, i - 2)], b = pathPts[Math.min(PATH_N - 1, i + 2)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      p.tx = tx / tl; p.ty = ty / tl;
      pathData.set([p.x, p.y, -p.ty, p.tx], i * 4);
      pathData.set([p.w, 0, 0, 0], (PATH_N + i) * 4);
    });
    gl.bindTexture(gl.TEXTURE_2D, pathTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PATH_N, 2, 0, gl.RGBA, gl.FLOAT, pathData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // direção do fluxo em cada objeto (para o lado que se desfaz e a entrada)
    for (const w of wps) {
      if (!w.obj) continue;
      const i = Math.round((w.l / L) * (PATH_N - 1));
      const p = pathPts[Math.max(0, i - 6)];
      w.obj.dir = [p.tx, p.ty];
    }
    byKey.maos.dir = [-bdir[0], -bdir[1]];
    byKey.fechamento.dir = [0, -1];
    // (objetos de trabalhos são opcionais: se o HTML não tem essas imagens, pula)
    for (const k of ['perfume', 'perfil', 'casa', 'tenis', 'agua-viva', 'cavalo']) if (byKey[k]) byKey[k].dir = [0.35, 0.94];

    // âncoras da cabeça: centro do objeto no centro da tela ↔ comprimento no caminho
    const maxS = Math.max(document.documentElement.scrollHeight - vh, 1);
    const list = [{ s: 0, y: 0 }];
    for (const w of wps) {
      if (!w.anchor) continue;
      list.push({ s: Math.min(w.y - vh * 0.5, maxS), y: w.l });
    }
    list.push({ s: maxS, y: L });
    anchors = [];
    for (const a of list) {
      const prev = anchors[anchors.length - 1];
      if (prev && (a.s <= prev.s + 1 || a.y < prev.y)) continue;
      anchors.push({ ...a });
    }
    if (anchors[anchors.length - 1].y < L) anchors[anchors.length - 1].y = L;
    tangents(anchors);
  }
  function tangents(a) {
    const n = a.length, dl = [];
    for (let i = 0; i < n - 1; i++) dl.push((a[i + 1].y - a[i].y) / (a[i + 1].s - a[i].s));
    for (let i = 0; i < n; i++) {
      if (i === 0) a[i].m = dl[0];
      else if (i === n - 1) a[i].m = dl[n - 2];
      else a[i].m = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (dl[i] === 0) { a[i].m = 0; a[i + 1].m = 0; continue; }
      const al = a[i].m / dl[i], be = a[i + 1].m / dl[i], h = al * al + be * be;
      if (h > 9) { const t = 3 / Math.sqrt(h); a[i].m = t * al * dl[i]; a[i + 1].m = t * be * dl[i]; }
    }
  }
  function headAt(s) {
    const a = anchors;
    if (a.length < 2) return 0;
    if (s <= a[0].s) return a[0].y;
    if (s >= a[a.length - 1].s) return a[a.length - 1].y;
    let i = 0;
    while (s > a[i + 1].s) i++;
    const h = a[i + 1].s - a[i].s, t = (s - a[i].s) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[i].y + (t3 - 2 * t2 + t) * h * a[i].m + (-2 * t3 + 3 * t2) * a[i + 1].y + (t3 - t2) * h * a[i + 1].m;
  }
  function pathAt(l) {
    const fi = Math.min(Math.max(l / plen, 0), 1) * (PATH_N - 1);
    const i = Math.floor(fi), t = fi - i;
    const a = pathPts[i], b = pathPts[Math.min(i + 1, PATH_N - 1)];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  // ---------- tipos desenhados com pontos: o título do hero e o wordmark do rodapé ----------
  // Cada letra é desenhada num canvas na posição exata do DOM; cada célula de tinta vira um ponto que voa
  // até o lugar. D (0..1) diz quanto a célula fica como pontos; S é a ordem em que ela vira letra sólida.
  function buildType(kind) {
    const isHero = kind === 'hero';
    const root = document.querySelector(isHero ? '[data-title]' : '[data-foot-word]');
    if (!root) return null;
    const words = isHero ? [...root.querySelectorAll('.w')] : [root.querySelector('.fw-txt')];
    const marks = isHero ? [] : [...root.querySelectorAll('.fw-mark i')];
    const fs = parseFloat(getComputedStyle(root).fontSize);
    const weight = isHero ? 400 : 500;
    const rs = [...words, ...marks].map(docRect);
    const pad = isHero ? fs * 0.28 : fs * 0.04;
    const x0 = Math.min(...rs.map((r) => r.x)) - pad, y0 = Math.min(...rs.map((r) => r.y)) - pad;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + pad, y1 = Math.max(...rs.map((r) => r.y + r.h)) + pad;
    const org = { x: Math.round(x0 * dpr) / dpr, y: Math.round(y0 * dpr) / dpr };
    const W = Math.ceil((x1 - x0) * dpr), H = Math.ceil((y1 - y0) * dpr);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.scale(dpr, dpr);
    ctx.font = `${weight} ${fs}px Satoshi`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const asc = ctx.measureText('Faça existir').fontBoundingBoxAscent ?? fs * 0.97;
    // cada letra na posição exata do DOM (o tracking negativo do CSS vale aqui também)
    for (const el of words) {
      const node = el.firstChild;
      const range = document.createRange();
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        ctx.fillText(node.data[i], r.left - org.x, r.top + window.scrollY - org.y + asc);
      }
    }
    for (const r of marks.map(docRect)) ctx.fillRect(r.x - org.x, r.y - org.y, r.w, r.h);
    const px = ctx.getImageData(0, 0, W, H).data;
    const cov = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) cov[i] = px[i * 4 + 3];

    // de onde os pontos saem e para onde arqueiam / respiram
    let src, arc, drift, spread, amp, Dat;
    if (isHero) {
      const band0 = mobile ? vw * 0.26 : vw * 0.19, widen = mobile ? 0.04 : 0.14;
      src = sph; arc = bdir; drift = bdir; spread = 40; amp = 1;
      Dat = (x, y) => {
        const vx = x - sph.x, vy = y - sph.y;
        const along = vx * bdir[0] + vy * bdir[1], perp = Math.abs(vx * bdir[1] - vy * bdir[0]);
        const band = band0 + Math.max(0, along) * widen;
        return 1 - smoothstep(band * 0.3, band * 1.05, perp);
      };
    } else {
      // o fluxo termina na luz da mão e "chove" no nome; a base do nome se desfaz em pontos até o corte
      const cut = docRect(root).y + root.offsetHeight;
      src = { x: vw / 2, y: cut - Math.max(vh * 0.9, fs * 1.6) };
      arc = [0, -1]; drift = [0, 1]; spread = vw * 0.5; amp = 0.45;
      Dat = (x, y) => smoothstep(cut - fs * (mobile ? 0.26 : 0.32), cut + fs * 0.03, y);
    }
    const nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
    const S8 = new Uint8Array(nx * ny);
    const at = [], au = [];
    let maxD = 1;
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        let sum = 0, cnt = 0;
        for (let yy = cy * cell; yy < Math.min(H, (cy + 1) * cell); yy++) for (let xx = cx * cell; xx < Math.min(W, (cx + 1) * cell); xx++) { sum += cov[yy * W + xx]; cnt++; }
        const c = sum / cnt / 255;
        const px_ = org.x + ((cx + 0.5) * cell) / dpr, py_ = org.y + ((cy + 0.5) * cell) / dpr;
        const D = Dat(px_, py_);
        const nz = Math.random();
        const S = (D + nz * (isHero ? 0.3 : 0.55)) / (isHero ? 0.5 : 0.62);
        S8[cy * nx + cx] = Math.min(255, Math.round((Math.min(S, 2) / 2) * 255));
        if (c >= 0.42) {
          const r = Math.random();
          const dist = isHero ? Math.hypot(px_ - src.x, py_ - src.y) : (px_ - org.x) * 0.35 + Math.abs(py_ - (org.y + H / dpr)) ;
          maxD = Math.max(maxD, dist);
          at.push(cx, cy, S, D);
          au.push(c, bayer8(cx, cy), r, dist);
        }
      }
    }
    for (let i = 3; i < au.length; i += 4) au[i] = (au[i] / maxD) * 0.85 + au[i - 1] * 0.3;

    const old = types[kind];
    if (old) { gl.deleteTexture(old.covTex); gl.deleteTexture(old.sTex); gl.deleteBuffer(old.b1); gl.deleteBuffer(old.b2); }
    const covTex = texture(gl, cov, { filter: gl.NEAREST, format: gl.RED, internal: gl.R8, w: W, h: H });
    const sTex = texture(gl, S8, { filter: gl.NEAREST, format: gl.RED, internal: gl.R8, w: nx, h: ny });
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b1 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(at), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    const b2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(au), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    types[kind] = { kind, org, W, H, covTex, sTex, vao, b1, b2, count: at.length / 4, src, arc, drift, spread, amp, state: isHero ? st : (old ? old.state : ft) };
    root.classList.add('is-gl');
  }

  // ---------- quadro ----------
  function frame() {
    const now = (performance.now() - time0) / 1000;
    const t = reduced ? 12 : now;
    const s = window.scrollY;
    if (!reduced) {
      mouse.px += (mouse.tx - mouse.px) * 0.06;
      mouse.py += (mouse.ty - mouse.py) * 0.06;
    }
    const mpar = [-mouse.px * 9, -mouse.py * 6];

    // pulso da esfera
    if (st.pulseOn && !reduced) {
      const ph = ((now - st.pulseT0) % 3.8) / 3.8;
      st.pulse = ph < 0.08 ? smoothstep(0, 0.08, ph) : Math.exp(-(ph - 0.08) * 6);
      st.ring = Math.min(1, ph / 0.75);
    }

    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.016, 0.078, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // objetos
    gl.bindVertexArray(quadVao);
    pQuad.use().f('u_res', cw, ch).f('u_cell', cell).i('u_tex', 0)
      .f('u_mouse', mouse.x * dpr, mouse.y * dpr).f('u_mr', mobile || reduced ? 0 : 110 * dpr);
    gl.activeTexture(gl.TEXTURE0);
    const objRects = [];
    for (const o of objs) {
      const r = o.rect;
      if (!r) continue;
      const cy = r.y + r.h / 2;
      let y = r.y - s - (o.c.f - 1) * (s - (cy - vh / 2));
      let x = r.x;
      if (o.key === 'maos') { x += mpar[0] * 0.8; y += mpar[1] * 0.8; }
      else if (o.c.f !== 1) { x += mpar[0] * o.c.f; y += mpar[1] * o.c.f; }
      const onScreen = y < vh + 80 && y + r.h > -80;
      if (onScreen && !o.loading) load(o);
      if (!o.revealed && o.key !== 'maos' && y < vh * 0.86 && y + r.h > 0) reveal(o);
      if (!onScreen || !o.tex || o.form <= 0) continue;
      if (AVOID_OBJ.has(o.key) && o.form > 0.25) {
        const ix = r.w * 0.02, iy = r.h * 0.02;
        objRects.push(x + ix, y + iy, x + r.w - ix, y + r.h - iy);
      }
      gl.bindTexture(gl.TEXTURE_2D, o.tex);
      pQuad.f('u_rect', Math.round(x * dpr), Math.round(y * dpr), r.w * dpr, r.h * dpr)
        .f('u_form', o.form).f('u_dir', o.dir[0], o.dir[1]).f('u_dis', o.c.dis * Math.pow(1 - o.form, 0.8))
        .f('u_tone', ...o.c.tone).f('u_seed', o.seed).f('u_edge', o.c.edge).f('u_fadeB', o.c.fadeB || 0).f('u_travel', o.c.travel ?? 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // partículas
    const head = headAt(s);
    const rects = objRects.slice(0, 64);
    for (const k of keep) {
      const y0 = k[1] - s, y1 = k[3] - s;
      if (y1 < -40 || y0 > vh + 40) continue;
      rects.push(k[0], y0, k[2], y1);
      if (rects.length >= 128) break;
    }
    const nr = rects.length / 4;
    while (rects.length < 128) rects.push(0, 0, 0, 0);
    gl.bindVertexArray(ptsVao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pathTex);
    pPts.use().f('u_vp', vw, vh).f('u_res', cw, ch).f('u_dpr', dpr).f('u_cell', cell).f('u_time', t).f('u_scroll', s)
      .f('u_mouse', mouse.x, mouse.y).f('u_mpar', mpar[0], mpar[1])
      .f('u_sph', sph.x + mpar[0] * 0.8, sph.y + mpar[1] * 0.8).f('u_sphR', sph.r).f('u_bdir', bdir[0], bdir[1])
      .f('u_blen', blen).f('u_reach', st.reach).f('u_stars', st.stars).f('u_pulse', st.pulse).f('u_fg', st.fg)
      .i('u_path', 1).i('u_pn', PATH_N).f('u_plen', plen).f('u_head', head)
      .v4('u_rects', new Float32Array(rects)).i('u_nr', nr);
    gl.drawArrays(gl.POINTS, 0, total);

    // título do hero e wordmark do rodapé
    const fw = types.foot;
    if (fw && !ft.played && fw.org.y - s < vh * 0.9) playFoot();
    for (const ty of [types.hero, fw]) {
      if (!ty || ty.org.y - s > vh || ty.org.y + ty.H / dpr - s < 0) continue;
      const S_ = ty.state;
      const ox = Math.round(ty.org.x * dpr), oy = Math.round((ty.org.y - s) * dpr);
      if (S_.solid > 0) {
        gl.bindVertexArray(quadVao);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ty.covTex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ty.sTex);
        pTitle.use().f('u_res', cw, ch).f('u_rect', ox, oy, ty.W, ty.H).f('u_cell', cell).f('u_solid', S_.solid).i('u_cov', 0).i('u_S', 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (S_.tT >= 0) {
        const hero = ty.kind === 'hero';
        const sx = hero ? sph.x + mpar[0] * 0.8 : ty.src.x, sy = hero ? sph.y + mpar[1] * 0.8 : ty.src.y;
        gl.bindVertexArray(ty.vao);
        pTpts.use().f('u_res', cw, ch).f('u_org', ox, oy)
          .f('u_sph', sx * dpr, (sy - s) * dpr).f('u_arc', ty.arc[0], ty.arc[1]).f('u_drift', ty.drift[0], ty.drift[1])
          .f('u_spread', ty.spread * dpr).f('u_amp', ty.amp)
          .f('u_cell', cell).f('u_dpr', dpr).f('u_tT', S_.tT).f('u_solid', S_.solid).f('u_time', t).f('u_pulse', hero ? st.pulse : 0);
        gl.drawArrays(gl.POINTS, 0, ty.count);
      }
    }

    // brilhos: esfera, cabeça do sinal, luz do fechamento
    gl.bindVertexArray(quadVao);
    pGlow.use().f('u_res', cw, ch).f('u_cell', cell);
    const glow = (x, y, R, int, ring, core, halo) => {
      if (int <= 0.001) return;
      const ext = R * (ring > 0 ? 4.2 : 3.4);
      if (y + ext < 0 || y - ext > vh) return;
      const cx = Math.round(x * dpr), cy = Math.round(y * dpr);
      pGlow.f('u_rect', cx - ext * dpr, cy - ext * dpr, ext * 2 * dpr, ext * 2 * dpr).f('u_c', cx, cy).f('u_R', R * dpr)
        .f('u_int', int).f('u_ring', ring).f('u_core', core).f('u_halo', halo);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    glow(sph.x + mpar[0] * 0.8, sph.y - s + mpar[1] * 0.8, sph.r * (1 + st.pulse * 0.05), st.glow, 1, Math.max(0, 1 - byKey.maos.form * 1.6), 0.42 + st.pulse * 0.3);
    // cabeça: só depois de sair da esfera, e apaga perto de texto
    const hp = pathAt(head);
    const hy = hp.y - s;
    let near = head > sph.r * 2 && head < plen - 30 ? 1 : 0;
    for (let i = 0; i < nr && near; i++) {
      const R = [rects[i * 4], rects[i * 4 + 1], rects[i * 4 + 2], rects[i * 4 + 3]];
      if (hp.x > R[0] - 40 && hp.x < R[2] + 40 && hy > R[1] - 40 && hy < R[3] + 40) near = 0;
    }
    st.headGlow += (near - st.headGlow) * 0.12;
    glow(hp.x + mpar[0], hy + mpar[1], 7, st.headGlow * (reduced ? 0 : 1), 0, 1, 0.75);
    if (spark) glow(spark.x, spark.y - s, 6 * (1 + st.pulse * 0.2), byKey.fechamento.form, 1, 1, 0.8);

    // mostrador do loader, em volta da esfera
    if (dial.a > 0.001) {
      const R = sph.r * dpr, ext = R * (dial.rad + 0.3);
      const cx = Math.round((sph.x + mpar[0] * 0.8) * dpr), cy = Math.round((sph.y - s + mpar[1] * 0.8) * dpr);
      pDial.use().f('u_res', cw, ch).f('u_cell', cell).f('u_rect', cx - ext, cy - ext, ext * 2, ext * 2).f('u_c', cx, cy)
        .f('u_R', R).f('u_prog', dial.prog).f('u_rad', dial.rad).f('u_a', dial.a);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function playFoot() {
    ft.played = true;
    if (reduced) { ft.tT = 99; ft.solid = 1; return; }
    gsap.timeline()
      .fromTo(ft, { tT: 0 }, { tT: 3.4, duration: 3.4, ease: 'none' }, 0)
      .to(ft, { solid: 1, duration: 1.4, ease: 'power2.inOut' }, 1.9)
      .add(() => { ft.tT = 99; });
  }

  function reveal(o, dur = 1.9) {
    if (o.revealed) return;
    o.revealed = true;
    load(o);
    if (reduced) { o.form = 1; return; }
    o.ready.then(() => gsap.to(o, { form: 1, duration: dur, ease: 'power2.out' }));
  }

  function marcaCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(80, 60, 430, 470);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#b9b9b9'); g.addColorStop(1, '#4a4a4a');
    x.fillStyle = g; x.strokeStyle = g;
    // símbolo de um cliente fictício: sol nascendo (disco cortado por três faixas) e um quadrado
    x.beginPath(); x.arc(256, 300, 190, Math.PI, 0); x.closePath(); x.fill();
    x.globalCompositeOperation = 'destination-out';
    for (const [y, h] of [[196, 22], [244, 26], [286, 30]]) x.fillRect(40, y, 432, h);
    x.globalCompositeOperation = 'source-over';
    x.fillRect(66, 334, 380, 40);
    x.fillRect(372, 70, 62, 62);
    const rg = x.createRadialGradient(170, 150, 10, 256, 256, 330);
    rg.addColorStop(0, 'rgba(255,255,255,0.0)'); rg.addColorStop(1, 'rgba(0,0,0,0.45)');
    x.globalCompositeOperation = 'source-atop'; x.fillStyle = rg; x.fillRect(0, 0, 512, 512);
    return c;
  }

  function onPointer(e) {
    if (mobile) return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.tx = (e.clientX / vw) * 2 - 1;
    mouse.ty = (e.clientY / vh) * 2 - 1;
  }

  measure();
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
  let rz;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(measure); });
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.querySelector('main'));
  ro.observe(document.querySelector('.foot'));

  return {
    st, dial, frame, measure, reveal, load, objs: byKey,
    sphere: () => ({ ...sph, blen }),
    startPulse() { st.pulseOn = true; st.pulseT0 = (performance.now() - time0) / 1000; },
    debug: () => ({ keep: keep.length, anchors, plen, sph, bdir, types: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, { count: v.count, W: v.W, H: v.H, org: v.org }])) }),
  };
}
