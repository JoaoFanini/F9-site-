import './styles/tokens.css';
import './styles/base.css';
import './styles/buttons.css';
import './sections/nav.css';
import './sections/hero.css';
import './sections/como.css';
import './sections/estudio.css';
import './sections/trabalhos.css';
import './sections/numeros.css';
import './sections/planos.css';
import './sections/final.css';
import './sections/loader.css';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createWorld } from './gl/world.js';
import { smoothScroll } from './motion/smooth.js';
import { intro } from './motion/intro.js';
import { carga } from './motion/carga.js';
import { loader } from './motion/loader.js';
import IMG from './gl/imagens.json';
import { reveals } from './motion/reveals.js';
import { prompt } from './motion/prompt.js';
import { nav } from './motion/nav.js';
import { fitFootWord } from './motion/footword.js';

gsap.registerPlugin(ScrollTrigger);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const hd = new URLSearchParams(location.search).has('hd');

// a carga começa antes de tudo: fontes e as mãos do hero; no ?hd, todas as imagens da peça
const FONTES = ['/fonts/satoshi-500.woff2', '/fonts/satoshi-400.woff2', '/fonts/instrument-serif-italic.woff2']; // a 500 (a do contador) primeiro
const IMAGENS = Object.keys(IMG).map((k) => `/img/${k}.webp`);
const c = carga([...FONTES, ...(hd ? IMAGENS : ['/img/maos.webp'])]);

let world = null;
try { world = createWorld({ reduced, src: c.url }); } catch (e) { console.error(e); }
gsap.ticker.add(() => world?.frame());
// com as fontes aplicadas, o título e o wordmark são rasterizados de novo, ainda durante o loader (não no quadro da passagem)
c.ready.then(() => { fitFootWord(); world?.measure(true); });

await loader({ world, carga: c, hd, reduced });

window.addEventListener('resize', fitFootWord);
reveals({ reduced });
prompt({ world, reduced });
const lenis = reduced ? null : smoothScroll();
const navUpdate = nav();
world?.measure(); // os textos foram divididos em linhas: refaz as áreas que o fluxo evita
gsap.ticker.add(navUpdate);
intro({ world, reduced });
ScrollTrigger.refresh();
window.__sinal = { world, lenis };
