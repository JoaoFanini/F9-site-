// Nav: some ao descer depois de meia tela e volta ao subir (com 6 px de folga). Fica preta depois de 40 px.
// Chamada no gsap.ticker: devolve a função que atualiza a nav a cada quadro.
export function nav() {
  const el = document.querySelector('[data-nav]');
  let ref = window.scrollY; // posição de referência para medir a direção
  let hidden = false;
  return () => {
    if (!el) return;
    const y = window.scrollY;
    el.classList.toggle('is-scrolled', y > 40);
    if (y - ref > 0 && y > window.innerHeight * 0.5 && !hidden) { hidden = true; el.classList.add('is-hidden'); ref = y; }
    else if (y - ref < -6 && hidden) { hidden = false; el.classList.remove('is-hidden'); ref = y; }
    else if (hidden === false) ref = Math.min(ref, y);
  };
}
