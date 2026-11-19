// "Como funciona": a frase é digitada por tempo assim que a seção começa a entrar, o botão Gerar é
// apertado e o status conta até "pronta". A baleia se condensa do fluxo em paralelo (world.reveal, que
// também dispara sozinho quando ela entra na tela): quem rola em ritmo normal sempre a vê formada.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const FRASE = 'Uma barbearia no centro de Uberlândia, com agendamento pelo WhatsApp';
const STATUS_FIM = 'Prévia pronta · revise com a gente';

export function prompt({ world, reduced = false }) {
  const box = document.querySelector('[data-prompt]');
  const out = box.querySelector('[data-prompt-text]');
  const status = box.querySelector('[data-prompt-status]');
  const go = box.querySelector('[data-prompt-go]');
  const baleia = world?.objs.baleia;
  if (reduced) { out.textContent = FRASE; status.textContent = STATUS_FIM; baleia && world.reveal(baleia); return; }
  if (baleia) world.load(baleia);

  function play() {
    const tl = gsap.timeline();
    const st = { n: 0 };
    tl.add(() => { baleia && world.reveal(baleia, 2.2); }, 0.1)
      .to(st, {
      n: FRASE.length, duration: FRASE.length * 0.024, ease: 'none',
      onUpdate: () => { out.textContent = FRASE.slice(0, Math.round(st.n)); },
    }, 0.2)
      .add(() => go.classList.add('is-press'), '+=0.15')
      .add(() => { go.classList.remove('is-press'); box.classList.add('is-busy'); }, '+=0.16')
      .to({ s: 0 }, {
        s: 38, duration: 1.2, ease: 'power1.inOut',
        onUpdate() { status.textContent = `Gerando · ${Math.round(this.targets()[0].s)} s`; },
      }, '<')
      .add(() => { box.classList.remove('is-busy'); status.textContent = STATUS_FIM; });
  }
  ScrollTrigger.create({ trigger: box, start: 'top bottom', once: true, onEnter: play });
}
