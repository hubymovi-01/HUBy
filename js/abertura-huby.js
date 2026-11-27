/* js/abertura-huby.js - Abertura animada do HUBy (rota acendendo, carro, pino e logo)
 * Uso: <script src="./js/abertura-huby.js" data-legenda="Mobilidade urbana"></script>
 * Coloque logo depois de <body>. Aparece uma vez por sessão; um toque pula.
 */
(function () {
  'use strict';

  var CHAVE_SESSAO = 'huby_abertura_vista';
  var DURACAO_MS = 3300;

  var scriptAtual = document.currentScript;
  var legenda = (scriptAtual && scriptAtual.getAttribute('data-legenda')) || 'Mobilidade urbana';

  // Já viu nesta sessão (inclusive na tela de boas-vindas) ou prefere menos movimento: não mostra
  try {
    if (sessionStorage.getItem(CHAVE_SESSAO) === '1') return;
  } catch (e) {}
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ROTA = 'M80 640 L82 525 Q84 505 104 503 L205 494 Q228 492 228 470 L229 360 Q229 338 250 336 L307 331 Q318 330 318 318 L316 230';

  var css = [
    '#hubyAbertura{position:fixed;inset:0;z-index:2147483000;background:#06090F;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;transition:opacity .6s cubic-bezier(.16,1,.3,1),visibility .6s;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
    '#hubyAbertura.hab-saindo{opacity:0;visibility:hidden}',
    '#hubyAbertura svg{position:absolute;inset:0;width:100%;height:100%}',
    '#hubyAbertura .hab-rua{stroke:rgba(148,163,184,.09);stroke-width:2;fill:none}',
    '#hubyAbertura .hab-rua-larga{stroke:rgba(148,163,184,.14);stroke-width:5;fill:none}',
    '#hubyAbertura .hab-grade{opacity:0;animation:habAparecer .8s ease .05s forwards}',
    '#hubyAbertura .hab-rota,#hubyAbertura .hab-sombra{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1}',
    '#hubyAbertura .hab-rota{stroke:#10B981;stroke-width:4;filter:url(#habBrilho)}',
    '#hubyAbertura .hab-sombra{stroke:rgba(16,185,129,.18);stroke-width:14}',
    '#hubyAbertura.hab-rodando .hab-rota,#hubyAbertura.hab-rodando .hab-sombra{animation:habDesenhar 1.6s cubic-bezier(.65,0,.35,1) forwards}',
    '#hubyAbertura .hab-carro{opacity:0}',
    '#hubyAbertura.hab-rodando .hab-carro{animation:habAparecer .25s ease forwards}',
    '#hubyAbertura .hab-pino{opacity:0;transform-box:fill-box;transform-origin:center bottom;animation:habPino .55s cubic-bezier(.16,1,.3,1) 1.85s forwards}',
    '#hubyAbertura .hab-onda{opacity:0;transform-box:fill-box;transform-origin:center;animation:habOnda 1.4s ease-out 2s 2}',
    '#hubyAbertura .hab-marca{position:relative;z-index:2;text-align:center;margin-top:46vh;color:#F8FAFC}',
    '#hubyAbertura .hab-letras{display:inline-flex;font-size:54px;font-weight:900;letter-spacing:-2.5px;line-height:1}',
    '#hubyAbertura .hab-letras b{display:inline-block;font-weight:900;opacity:0;transform:translateY(22px);filter:blur(6px);animation:habLetra .7s cubic-bezier(.16,1,.3,1) forwards}',
    '#hubyAbertura .hab-letras b:nth-child(1){animation-delay:1.75s}',
    '#hubyAbertura .hab-letras b:nth-child(2){animation-delay:1.83s}',
    '#hubyAbertura .hab-letras b:nth-child(3){animation-delay:1.91s}',
    '#hubyAbertura .hab-letras b:nth-child(4){animation-delay:1.99s;color:#10B981}',
    '#hubyAbertura .hab-legenda{display:block;margin-top:10px;font-size:11px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#64748B;opacity:0;animation:habAparecer .8s ease 2.25s forwards}',
    '#hubyAbertura .hab-pular{position:absolute;z-index:3;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);text-align:center;font-size:11px;color:#64748B;opacity:0;animation:habAparecer .6s ease 1s forwards}',
    '@keyframes habAparecer{to{opacity:1}}',
    '@keyframes habDesenhar{to{stroke-dashoffset:0}}',
    '@keyframes habPino{0%{opacity:0;transform:translateY(-14px) scale(.6)}100%{opacity:1;transform:translateY(0) scale(1)}}',
    '@keyframes habOnda{0%{opacity:.7;transform:scale(.4)}100%{opacity:0;transform:scale(2.6)}}',
    '@keyframes habLetra{to{opacity:1;transform:translateY(0);filter:blur(0)}}'
  ].join('\n');

  var svg =
    '<svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs>' +
        '<filter id="habBrilho" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
        '<radialGradient id="habLuz" cx="50%" cy="38%" r="60%"><stop offset="0%" stop-color="#10B981" stop-opacity="0.16"/><stop offset="100%" stop-color="#10B981" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<rect width="400" height="800" fill="url(#habLuz)"/>' +
      '<g class="hab-grade">' +
        '<path class="hab-rua-larga" d="M-20 150 L420 110 M-20 520 L420 480 M90 -20 L70 820 M300 -20 L320 820"/>' +
        '<path class="hab-rua" d="M-20 60 L420 30 M-20 250 L420 215 M-20 360 L420 330 M-20 650 L420 610 M-20 740 L420 710 M20 -20 L0 820 M180 -20 L170 820 M230 -20 L230 820 M380 -20 L400 820"/>' +
      '</g>' +
      '<path class="hab-sombra" pathLength="1" d="' + ROTA + '"/>' +
      '<path class="hab-rota" pathLength="1" d="' + ROTA + '"/>' +
      '<g class="hab-carro"><g>' +
        '<rect x="-13" y="-7.5" width="26" height="15" rx="5" fill="#F8FAFC"/>' +
        '<rect x="1" y="-6" width="7" height="12" rx="2" fill="#0F172A"/>' +
        '<rect x="-10" y="-5.5" width="5" height="11" rx="1.5" fill="#0F172A" opacity="0.8"/>' +
        '<rect x="11" y="-6" width="2.2" height="3" rx="1" fill="#FDE68A"/>' +
        '<rect x="11" y="3" width="2.2" height="3" rx="1" fill="#FDE68A"/>' +
        '<animateMotion id="habMovimento" dur="1.6s" begin="indefinite" fill="freeze" rotate="auto" calcMode="spline" keyTimes="0;1" keySplines="0.65 0 0.35 1" path="' + ROTA + '"/>' +
      '</g></g>' +
      '<circle class="hab-onda" cx="316" cy="228" r="16" fill="none" stroke="#10B981" stroke-width="2"/>' +
      '<g class="hab-pino">' +
        '<path d="M316 196 C303 196 294 205 294 217 C294 232 316 250 316 250 C316 250 338 232 338 217 C338 205 329 196 316 196 Z" fill="#10B981"/>' +
        '<circle cx="316" cy="217" r="7" fill="#06090F"/>' +
      '</g>' +
    '</svg>';

  // Monta a abertura
  var estilo = document.createElement('style');
  estilo.id = 'hubyAberturaEstilo';
  estilo.textContent = css;
  (document.head || document.documentElement).appendChild(estilo);

  var raiz = document.createElement('div');
  raiz.id = 'hubyAbertura';
  raiz.setAttribute('aria-hidden', 'true');
  raiz.innerHTML = svg +
    '<div class="hab-marca"><div class="hab-letras"><b>H</b><b>U</b><b>B</b><b>y</b></div><small class="hab-legenda"></small></div>' +
    '<div class="hab-pular">Toque para pular</div>';
  raiz.querySelector('.hab-legenda').textContent = String(legenda).slice(0, 40); // texto puro

  var alvo = document.body || document.documentElement;
  alvo.appendChild(raiz);

  var encerrada = false;
  function encerrar() {
    if (encerrada) return;
    encerrada = true;
    try { sessionStorage.setItem(CHAVE_SESSAO, '1'); } catch (e) {}
    raiz.classList.add('hab-saindo');
    setTimeout(function () {
      raiz.remove();
      estilo.remove();
    }, 700);
  }

  raiz.addEventListener('click', encerrar);

  // A linha acende e o carro vai logo atrás, sempre em cima dela
  setTimeout(function () {
    raiz.classList.add('hab-rodando');
    setTimeout(function () {
      var mov = document.getElementById('habMovimento');
      try { if (mov) mov.beginElement(); } catch (e) {}
    }, 140);
  }, 350);

  setTimeout(encerrar, DURACAO_MS);
})();