// js/ia/motorista-ia.js - Microfone Blindado Anti-Loop com Raciocínio Livre Situacional
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada } from '../motorista/motorista-radar.js';
import { preVisualizarRotaPedido } from '../motorista/motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaDesejada = false;
let sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;
let falandoAgora = false;
let timeoutReinicio = null;
let wakeLockSentinel = null;
let processandoRequisicao = false;

function normalizarTexto(txt = '') {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function saoPalavrasParecidas(p1, p2) {
  if (!p1 || !p2) return false;
  if (p1 === p2 || p1.includes(p2) || p2.includes(p1)) return true;

  const len1 = p1.length;
  const len2 = p2.length;
  if (Math.abs(len1 - len2) > 2) return false;

  let matriz = [];
  for (let i = 0; i <= len1; i++) matriz[i] = [i];
  for (let j = 0; j <= len2; j++) matriz[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const custo = p1[i - 1] === p2[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + custo
      );
    }
  }
  return matriz[len1][len2] <= 2;
}

export function obterCodigoAtivacaoMotorista() {
  const salvo = localStorage.getItem('huby_codigo_voz_motorista');
  return salvo && salvo.trim() ? salvo.trim() : 'OK HUBy';
}

export async function definirCodigoAtivacaoMotorista(novaFrase) {
  if (!novaFrase || !novaFrase.trim()) return false;
  const fraseLimpa = novaFrase.trim();
  localStorage.setItem('huby_codigo_voz_motorista', fraseLimpa);

  try {
    await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ codigo_voz: fraseLimpa })
    });
  } catch (e) {
    console.warn('Persistência local mantida para ativação.');
  }

  falarTexto(`Comando configurado para: ${fraseLimpa}`);
  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

export function falarTexto(texto) {
  if (!sintetizador) return;
  try {
    sintetizador.cancel();
    falandoAgora = true;

    // Pausa o reconhecimento enquanto a IA fala para o microfone não capturar a própria voz
    pausarReconhecimentoTemporariamente();

    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 1.15;
    utter.pitch = 1.0;

    utter.onend = () => {
      falandoAgora = false;
      retomarReconhecimentoAposFala();
    };

    utter.onerror = () => {
      falandoAgora = false;
      retomarReconhecimentoAposFala();
    };

    sintetizador.speak(utter);
  } catch (err) {
    falandoAgora = false;
    retomarReconhecimentoAposFala();
  }
}

function pausarReconhecimentoTemporariamente() {
  if (recognition) {
    try { recognition.abort(); } catch (e) {}
  }
}

function retomarReconhecimentoAposFala() {
  if (!escutaDesejada) return;
  if (timeoutReinicio) clearTimeout(timeoutReinicio);
  timeoutReinicio = setTimeout(() => {
    iniciarInstanciaMicrofone();
  }, 400);
}

async function requisitarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (e) {}
  }
}

function liberarWakeLock() {
  if (wakeLockSentinel) {
    try { wakeLockSentinel.release(); } catch (e) {}
    wakeLockSentinel = null;
  }
}

function capturarContextoCompletoApp() {
  const saldoElement = document.getElementById('saldoCarteiraValor') || document.getElementById('drawerSaldoValor');
  const saldo = saldoElement ? saldoElement.textContent.trim() : 'R$ 0,00';
  const ganhosHoje = document.getElementById('lblGanhosHojeValor')?.textContent.trim() || 'R$ 0,00';
  const corridasHoje = document.getElementById('lblCorridasHojeQtd')?.textContent.trim() || '0 corridas';

  const nomeCondutor = document.getElementById('drawerNomeCondutor')?.textContent.trim() || 'Carol';
  const modeloVeiculo = document.getElementById('drawerCarroModelo')?.textContent.trim() || '';
  const placaVeiculo = document.getElementById('drawerCarroPlaca')?.textContent.trim() || '';
  const detalhesVeiculo = document.getElementById('drawerCarroDetalhes')?.textContent.trim() || '';

  const cardsChamadas = document.querySelectorAll('#listaChamadasPendentes .btn-accept-order');
  const qtdChamadas = cardsChamadas.length;
  let dadosPrimeiraChamada = null;
  if (qtdChamadas > 0) {
    dadosPrimeiraChamada = extrairDadosDoBotao(cardsChamadas[0]);
  }

  const previaAberta = Boolean(document.getElementById('modalPreviaRotaCorrida')?.offsetParent || document.getElementById('btnConfirmarAceiteViagem')?.offsetParent);
  const drawerAberto = Boolean(document.getElementById('driverDrawer')?.classList.contains('active'));

  return {
    statusOnline: estado.isOnline,
    saldo,
    ganhosHoje,
    corridasHoje,
    nomeCondutor,
    veiculo: `${modeloVeiculo} ${detalhesVeiculo} Placa ${placaVeiculo}`,
    qtdChamadasNoRadar: qtdChamadas,
    primeiraChamadaRadar: dadosPrimeiraChamada,
    corridaAtivaId: estado.pedidoAtivoId || null,
    telasAbertas: {
      previaRota: previaAberta,
      drawerPerfil: drawerAberto
    }
  };
}

// Inicializador Único e Estável do Microfone
export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  if (recognition) {
    try { recognition.abort(); } catch (e) {}
    recognition = null;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    atualizarIndicadorUIVoz(true);
    requisitarWakeLock();
  };

  recognition.onend = () => {
    // Só reinicia se estiver explicitamente online, ativo e sem estar falando
    const online = estado.isOnline || localStorage.getItem('huby_motorista_online') === 'true';

    if (escutaDesejada && online && !falandoAgora) {
      if (timeoutReinicio) clearTimeout(timeoutReinicio);
      timeoutReinicio = setTimeout(() => {
        iniciarInstanciaMicrofone();
      }, 600); // 600ms de respiro previne o loop do Android
    } else if (!escutaDesejada) {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      console.warn('Microfone copiloto info:', ev.error);
    }
  };

  recognition.onresult = (ev) => {
    const ultimo = ev.results[ev.results.length - 1];
    if (!ultimo || !ultimo[0] || falandoAgora) return;
    processarFalaCognitiva(ultimo[0].transcript);
  };

  return true;
}

function iniciarInstanciaMicrofone() {
  if (!recognition) inicializarCopilotoVoz();
  try {
    recognition.start();
  } catch (e) {}
}

export function ativarEscutaCopiloto() {
  escutaDesejada = true;
  iniciarInstanciaMicrofone();
  const comandoAtual = obterCodigoAtivacaoMotorista();
  notificar(`Copiloto ativo: "${comandoAtual}"`, 'info', 2200);
}

export function desativarEscutaCopiloto() {
  escutaDesejada = false;
  if (timeoutReinicio) clearTimeout(timeoutReinicio);

  if (recognition) {
    try { recognition.abort(); } catch (e) {}
  }
  atualizarIndicadorUIVoz(false);
  liberarWakeLock();
}

// Cérebro Livre: Compreensão de Intenção Situacional
async function processarFalaCognitiva(fraseBruta) {
  if (processandoRequisicao || falandoAgora) return;

  const fraseFalada = normalizarTexto(fraseBruta);
  const gatilhoCadastrado = normalizarTexto(obterCodigoAtivacaoMotorista());
  const palavrasFaladas = fraseFalada.split(' ');

  const partesGatilho = gatilhoCadastrado.split(' ').filter(p => !['ok', 'ei', 'fala', 'e', 'ai'].includes(p));
  const palavraChavePrincipal = partesGatilho[partesGatilho.length - 1] || gatilhoCadastrado;

  let gatilhoDetectado = fraseFalada.includes(gatilhoCadastrado);

  if (!gatilhoDetectado) {
    for (const palavra of palavrasFaladas) {
      if (saoPalavrasParecidas(palavra, palavraChavePrincipal)) {
        gatilhoDetectado = true;
        break;
      }
    }
  }

  // Se o motorista não se dirigiu à IA pelo gatilho, ignora barulhos do trânsito
  if (!gatilhoDetectado) return;

  processandoRequisicao = true;

  let mensagemLimpa = fraseFalada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b${palavraChavePrincipal}\\b`, 'gi'), '')
    .replace(/^(ok|ei|fala|e ai)\s+/i, '')
    .trim();

  // Caso chame apenas pelo nome ("Ok Zanix")
  if (mensagemLimpa.length === 0 || mensagemLimpa === 'ola' || mensagemLimpa === 'opa') {
    processandoRequisicao = false;
    falarTexto('Na escuta, piloto.');
    return;
  }

  const contexto = capturarContextoCompletoApp();

  try {
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...obterHeaders()
      },
      body: JSON.stringify({
        pergunta: mensagemLimpa,
        contextoCompleto: contexto
      })
    });

    const data = await resp.json().catch(() => null);

    if (data && data.resposta) {
      falarTexto(data.resposta);
      if (data.acao && data.acao !== 'NENHUMA') {
        executarAcaoDecididaPelaMente(data.acao);
      }
    } else {
      falarTexto('Copiado.');
    }
  } catch (err) {
    falarTexto('Acompanhando sua rota.');
  } finally {
    processandoRequisicao = false;
  }
}

// Execução Dinâmica de Ações na Tela do Motorista
function executarAcaoDecididaPelaMente(acao) {
  switch (acao) {
    case 'VISUALIZAR_ROTA': {
      const btn = document.querySelector('#listaChamadasPendentes .btn-accept-order') ||
                  document.querySelector('button.btn-accept-order');
      if (btn) {
        pararAlertaSonoroChamada();
        btn.click();
      }
      break;
    }
    case 'ACEITAR_CORRIDA': {
      const btnModal = document.getElementById('btnConfirmarAceiteViagem') || 
                       document.querySelector('button.btn-confirmar-aceite');
      if (btnModal && btnModal.offsetParent !== null) {
        btnModal.click();
      } else {
        const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
        if (primeiroBtn) {
          preVisualizarRotaPedido(extrairDadosDoBotao(primeiroBtn));
          setTimeout(() => {
            document.getElementById('btnConfirmarAceiteViagem')?.click();
          }, 400);
        }
      }
      break;
    }
    case 'CANCELAR_ROTA': {
      const btnFecharPrevia = document.getElementById('btnCancelarPreviaRota') ||
                              document.querySelector('.btn-fechar-previa');
      if (btnFecharPrevia && btnFecharPrevia.offsetParent !== null) {
        btnFecharPrevia.click();
      } else {
        const btnDispensa = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
        if (btnDispensa) btnDispensa.click();
      }
      break;
    }
    case 'AVISAR_CHEGADA':
      document.getElementById('btnChegueiLocalEmbarque')?.click();
      break;
    case 'INICIAR_VIAGEM':
      document.getElementById('btnIniciarCorridaAtiva')?.click();
      break;
    case 'FINALIZAR_CORRIDA':
      document.getElementById('btnConcluirCorrida')?.click();
      break;
    case 'ABRIR_SAQUE':
      document.getElementById('btnAbrirModalSaque')?.click();
      break;
    case 'ABRIR_PERFIL':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      break;
    case 'FECHAR_TELAS':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnFecharModalEdicao')?.click();
      document.getElementById('btnCancelarPreviaRota')?.click();
      break;
  }
}

function atualizarIndicadorUIVoz(ativo) {
  let badge = document.getElementById('badgeCopilotoVozStatus');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'badgeCopilotoVozStatus';
    badge.style.position = 'fixed';
    badge.style.bottom = '22px';
    badge.style.right = '18px';
    badge.style.zIndex = '9999';
    badge.style.padding = '8px 14px';
    badge.style.borderRadius = '24px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '800';
    badge.style.backdropFilter = 'blur(12px)';
    badge.style.webkitBackdropFilter = 'blur(12px)';
    badge.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    badge.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    document.body.appendChild(badge);
  }

  const gatilho = obterCodigoAtivacaoMotorista();
  if (ativo) {
    badge.style.background = 'rgba(16, 185, 129, 0.22)';
    badge.style.border = '1px solid #10B981';
    badge.style.color = '#10B981';
    badge.innerHTML = `🎙️ "${gatilho}" Pronto`;
  } else {
    badge.style.background = 'rgba(15, 23, 42, 0.85)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    badge.style.color = '#94A3B8';
    badge.innerHTML = `🎙️ "${gatilho}" Pausado`;
  }
}