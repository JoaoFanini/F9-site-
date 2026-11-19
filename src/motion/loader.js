// Loader: o sinal sintonizando. Em volta de onde a esfera vai acender, um mostrador de 64 marcas em pontos
// 1-bit acende conforme os bytes chegam; o disco da esfera e as estrelas se condensam no mesmo ritmo e o
// contador embaixo mostra o progresso real (carga.js). Com tudo pronto (fontes aplicadas, mãos decodificadas),
// o contador sai, o anel abre como uma onda e a entrada (intro.js) começa dos valores em que o loader parou:
// sem corte, sem quadro preto. Rolagem travada até lá. ?hd: segura até todas as imagens da peça baixarem.
import { gsap } from 'gsap';

const MIN_TIME = 0.8;   // cache quente: o mostrador ainda dá a volta, sem piscar
const MAX_WAIT = 9;     // rede lenta: depois disso segue com o que tiver
const MAX_WAIT_HD = 60;
const GLOW = 0.4;       // quanto da esfera o loader acende (a entrada leva até 1)
const STARS = 0.3;

export function loader({ world, carga, hd = false, reduced = false }) {
  const el = document.querySelector('[data-loader]');
  const n = el.querySelector('[data-loader-n]');
  const tag = el.querySelector('.loader__tag');
  const unlock = lockScroll();
  const fusao = reduced || !world;
  if (fusao) el.classList.add('loader--fusao');
  if (hd) el.querySelector('[data-loader-what]').textContent = 'sintonizando em HD';

  const place = () => {
    if (!world) return;
    const s = world.sphere();
    el.style.setProperty('--lx', `${s.x}px`);
    el.style.setProperty('--sy', `${s.y}px`);
    el.style.setProperty('--ly', `${s.y + s.r * 1.98}px`);
  };
  // a marca de antes do JS sai de onde estiver no pisca (com cache ela nem apareceu); o mostrador no canvas assume
  const boot = el.querySelector('.loader__boot');
  const bootO = Number(getComputedStyle(boot).opacity);
  boot.style.animation = 'none';
  gsap.fromTo(boot, { opacity: bootO }, { opacity: 0, duration: 0.35, ease: 'power1.out' });
  place();
  window.addEventListener('resize', place);
  // o contador aparece com a própria fonte (é a primeira a chegar): nunca em fonte de sistema trocando no meio
  carga.file('/fonts/satoshi-500.woff2').then(() => el.classList.add('is-on'));

  // o que precisa estar pronto, além dos bytes: as fontes aplicadas e a textura das mãos decodificada
  const maos = Promise.all([carga.ready, world?.load(world.objs.maos)]);
  // (as fontes já entram carregadas no document.fonts pela carga.js; document.fonts.load baixaria a face do CSS também)
  let pronto = false;
  maos.then(() => { pronto = true; });

  const t0 = performance.now();
  const shown = { v: 0 };
  let last = -1;
  window.__carga = { log: [], introAt: null, t0: performance.timeOrigin + t0 }; // para o teste de rede lenta

  return new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const pr = carga.progress();
      const limit = t > (hd ? MAX_WAIT_HD : MAX_WAIT);
      const real = pronto ? 1 : Math.min(pr.p, 0.995);
      const target = Math.min(limit ? 1 : real, t / MIN_TIME);
      // nunca volta: o total pode crescer quando chega o tamanho real de um arquivo maior que a estimativa
      shown.v += Math.max(0, target - shown.v) * (limit ? 0.25 : 0.2);
      if (target >= 1 && shown.v > 0.996) shown.v = 1;
      const k = Math.floor(shown.v * 100);
      if (k !== last) {
        last = k;
        n.textContent = k;
        el.setAttribute('aria-valuenow', k);
        window.__carga.log.push({ t: +t.toFixed(3), shown: k, real: +pr.p.toFixed(3), got: pr.got, total: pr.total, files: pr.files });
      }
      if (world && !reduced) {
        world.dial.prog = shown.v;
        world.dial.a = Math.min(1, t / 0.45);
        world.st.glow = GLOW * shown.v;
        world.st.stars = STARS * shown.v;
        // o vazamento da esfera (início da explosão) cresce com a carga e chega em 0, de onde a entrada parte
        const sp = world.sphere();
        world.st.reach = -(0.22 * sp.r / sp.blen) * (1 - shown.v);
      }
      if (shown.v >= 1 && (pronto || limit)) {
        gsap.ticker.remove(tick);
        window.__carga.introAt = +t.toFixed(3);
        window.__carga.pronto = pronto;
        sair();
      }
    };
    gsap.ticker.add(tick);

    function sair() {
      window.removeEventListener('resize', place);
      unlock();
      const fim = () => { el.remove(); };
      if (fusao) {
        resolve();
        gsap.to(el, { opacity: 0, duration: 0.6, ease: 'power1.inOut', onComplete: fim });
        return;
      }
      // o contador sai primeiro; o anel abre como a onda de um sinal enquanto a esfera acende
      gsap.timeline({ onComplete: fim })
        .to(tag, { opacity: 0, y: -6, duration: 0.28, ease: 'power3.in' }, 0)
        .to(world.dial, { rad: 2.7, duration: 1.1, ease: 'expo.out' }, 0.14)
        .to(world.dial, { a: 0, duration: 0.8, ease: 'power2.in' }, 0.22)
        .add(resolve, 0.1);
    }
  });
}

// Trava a rolagem sem esconder a barra (esconder muda a largura da tela e o layout pula na liberação).
function lockScroll() {
  const keys = new Set([' ', 'PageDown', 'PageUp', 'End', 'Home', 'ArrowDown', 'ArrowUp']);
  const stop = (e) => e.preventDefault();
  const key = (e) => { if (keys.has(e.key)) e.preventDefault(); };
  const top = () => { if (window.scrollY) window.scrollTo(0, 0); };
  const opt = { passive: false };
  window.addEventListener('wheel', stop, opt);
  window.addEventListener('touchmove', stop, opt);
  window.addEventListener('keydown', key);
  window.addEventListener('scroll', top);
  return () => {
    window.removeEventListener('wheel', stop, opt);
    window.removeEventListener('touchmove', stop, opt);
    window.removeEventListener('keydown', key);
    window.removeEventListener('scroll', top);
  };
}
