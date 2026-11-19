// Wordmark do rodapé de borda a borda: o tamanho é medido (não chutado em vw). A largura de tinta de
// "sinal" (sem as folgas laterais das letras) mais a marca de dois quadrados enche exatamente a largura
// entre as margens; depois a caixa é cortada um pouco acima da linha de base, rente ao fim da página.
const MARK = 0.6;   // lado da marca, em em
const GAP = 0.085;  // espaço entre a marca e o "s", em em
const LS = -0.055;  // tracking, em em (o mesmo do CSS)
const CUT = 0.07;   // quanto da base fica cortado, em em

export function fitFootWord() {
  const el = document.querySelector('[data-foot-word]');
  if (!el) return;
  const txt = el.querySelector('.fw-txt');
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '500 100px Satoshi';
  const word = txt.textContent.trim();                   // mede a palavra que está no HTML (ex.: "f9 coding")
  const m = ctx.measureText(word);
  const inkL = -m.actualBoundingBoxLeft;                 // onde a tinta da primeira letra começa, a partir da origem
  const ink = m.actualBoundingBoxRight + m.actualBoundingBoxLeft + (word.length - 1) * LS * 100;
  const target = el.clientWidth;
  const fs = (target / ((MARK + GAP) * 100 + ink)) * 100;
  el.style.fontSize = fs + 'px';
  txt.style.marginLeft = (GAP * fs - (inkL * fs) / 100) + 'px';
  // altura: do topo da caixa até um pouco acima da linha de base
  // linha de base medida no DOM: um marcador de altura zero alinhado à base, no fim do texto
  let probe = txt.querySelector('.fw-base');
  if (!probe) { probe = document.createElement('i'); probe.className = 'fw-base'; probe.setAttribute('aria-hidden', 'true'); txt.append(probe); }
  el.style.height = '';
  const base = probe.getBoundingClientRect().top - el.getBoundingClientRect().top;
  el.style.height = base - CUT * fs + 'px';
  // a marca assenta na linha de base, como na nav
  el.querySelector('.fw-mark').style.marginTop = base - MARK * fs + 'px';
  return { fs, target };
}
