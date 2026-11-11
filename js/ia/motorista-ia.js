// js/ia/motorista-ia.js - Copiloto Humanizado com Raciocínio Situacional e Ações Dinâmicas
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada } from '../motorista/motorista-radar.js';
import { preVisualizarRotaPedido } from '../motorista/motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaDesejada = false;
let sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;
let processandoComando = false;
let timeoutReinicio = null;
let wakeLockSentinel = null;
let copilotoAguardandoComando = false;
let timeoutJanelaComando = null;

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
  if (p1 === p2) return true;
  if (p1.includes(p2) || p2.includes(p1)) return true;

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
    console.warn('Comando salvo localmente.');
  }

  falarTexto(`Comando configurado para: ${fraseLimpa}`);
  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

export function falarTexto(texto) {
  if (!sintetizador) return;
  try {
    sintetizador.cancel();
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 1.15;
    utter.pitch = 1.0;
    sintetizador.speak(utter);
  } catch (err) {
    console.warn('Falha no sintetizador:', err);
  }
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

// Captura fiel e dinâmica de todo o ecossistema visual
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

export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  if (recognition) {
    try { recognition.stop(); } catch (e) {}
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
    const online = estado.isOnline || localStorage.getItem('huby_motorista_online') === 'true';
    if (escutaDesejada && online) {
      if (timeoutReinicio) clearTimeout(timeoutReinicio);
      timeoutReinicio = setTimeout(() => {
        if (escutaDesejada && recognition) {
          try {
            recognition.start();
          } catch (e) {}
        }
      }, 500);
    } else {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error !== 'no-speech') {
      console.warn('Status microfone:', ev.error);
    }
  };

  recognition.onresult = (ev) => {
    const ultimo = ev.results[ev.results.length - 1];
    if (!ultimo || !ultimo[0]) return;
    processarFalaMotorista(ultimo[0].transcript);
  };

  return true;
}

export function ativarEscutaCopiloto() {
  escutaDesejada = true;
  if (!recognition) inicializarCopilotoVoz();

  try {
    recognition.start();
    const comandoAtual = obterCodigoAtivacaoMotorista();
    notificar(`Copiloto ativo: Diga "${comandoAtual}"`, 'info', 2500);
  } catch (e) {}
}

export function desativarEscutaCopiloto() {
  escutaDesejada = false;
  copilotoAguardandoComando = false;
  if (timeoutReinicio) clearTimeout(timeoutReinicio);
  if (timeoutJanelaComando) clearTimeout(timeoutJanelaComando);

  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  atualizarIndicadorUIVoz(false);
  liberarWakeLock();
}

async function processarFalaMotorista(fraseBruta) {
  if (processandoComando) return;

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

  // Permite comandos sem repetir o nome caso a janela de escuta esteja aberta
  if (!gatilhoDetectado && !copilotoAguardandoComando) return;

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 900);

  let acao = fraseFalada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b${palavraChavePrincipal}\\b`, 'gi'), '')
    .replace(/^(ok|ei|fala|e ai)\s+/i, '')
    .trim();

  // Se chamou apenas o nome (ex: "Ok Zanix"), abre janela de 9 segundos
  if (acao.length === 0 || acao === 'ola' || acao === 'opa' || acao === 'e ai') {
    copilotoAguardandoComando = true;
    if (timeoutJanelaComando) clearTimeout(timeoutJanelaComando);
    timeoutJanelaComando = setTimeout(() => { copilotoAguardandoComando = false; }, 9000);
    falarTexto('Pode falar, parceiro.');
    return;
  }

  copilotoAguardandoComando = false;

  // --------------------------------------------------------------------------
  // REAÇÕES INSTANTÂNEAS DE BAIXA LATÊNCIA (DISPARO IMEDIATO)
  // --------------------------------------------------------------------------

  // 1. CANCELAR / FECHAR / VOLTAR / DESCARTAR
  if (
    acao.includes('cancela') || acao.includes('volta') || acao.includes('fecha') ||
    acao.includes('dispensa') || acao.includes('recusa') || acao.includes('nao quero') ||
    acao.includes('esquece') || acao.includes('sai fora')
  ) {
    cmdCancelarOuDispensar();
    return;
  }

  // 2. INICIAR VIAGEM / DAR PARTIDA
  if (
    acao.includes('inicia') || acao.includes('comeca') || acao.includes('partiu') ||
    acao.includes('embarcou') || acao.includes('partida') || acao.includes('pode ir') ||
    acao.includes('bora') || acao.includes('vamos rodar')
  ) {
    cmdIniciarViagem();
    return;
  }

  // 3. CHEGADA AO LOCAL
  if (
    acao.includes('cheguei') || acao.includes('no local') || acao.includes('estou aqui') ||
    acao.includes('to aqui') || acao.includes('chegando')
  ) {
    cmdAvisarChegada();
    return;
  }

  // 4. ACEITAR CORRIDA
  if (
    acao.includes('aceita') || acao.includes('confirma') || acao.includes('pega') ||
    acao.includes('vou fazer') || acao.includes('pode pegar') || acao.includes('fechou')
  ) {
    cmdAceitarChamada();
    return;
  }

  // 5. VISUALIZAR ROTA
  if (
    acao.includes('visualizar') || acao.includes('ver rota') || acao.includes('mostra') ||
    acao.includes('olhar rota') || acao.includes('abrir mapa')
  ) {
    cmdVerRotaNoMapa();
    return;
  }

  // --------------------------------------------------------------------------
  // PROCESSAMENTO COGNITIVO COM GEMINI (RACIOCÍNIO + AÇÃO AUTÔNOMA)
  // --------------------------------------------------------------------------
  await processarCognicaoGemini(fraseBruta);
}

async function processarCognicaoGemini(perguntaCompleta) {
  const contexto = capturarContextoCompletoApp();

  try {
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...obterHeaders()
      },
      body: JSON.stringify({
        pergunta: perguntaCompleta,
        contextoCompleto: contexto
      })
    });

    const data = await resp.json().catch(() => null);
    if (!data || !data.resposta) {
      falarTexto('Tô monitorando o mapa com você.');
      return;
    }

    falarTexto(data.resposta);

    if (data.acao && data.acao !== 'NENHUMA') {
      executarAcaoInteligente(data.acao);
    }
  } catch (err) {
    falarTexto('Estou atento no trajeto.');
  }
}

function executarAcaoInteligente(acao) {
  switch (acao) {
    case 'CANCELAR_ROTA':
      cmdCancelarOuDispensar();
      break;
    case 'ACEITAR_CORRIDA':
      cmdAceitarChamada();
      break;
    case 'VISUALIZAR_ROTA':
      cmdVerRotaNoMapa();
      break;
    case 'AVISAR_CHEGADA':
      cmdAvisarChegada();
      break;
    case 'INICIAR_VIAGEM':
      cmdIniciarViagem();
      break;
    case 'FINALIZAR_CORRIDA':
      cmdFinalizarViagem();
      break;
    case 'ABRIR_SAQUE':
      document.getElementById('btnAbrirModalSaque')?.click();
      break;
    case 'ABRIR_PERFIL':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      break;
    case 'FECHAR_TELAS':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnCancelarPreviaRota')?.click();
      break;
  }
}

// ----------------------------------------------------------------------------
// AÇÕES FÍSICAS DE CONTROLE DA TELA
// ----------------------------------------------------------------------------

function cmdCancelarOuDispensar() {
  const btnFecharPrevia = document.getElementById('btnCancelarPreviaRota') ||
                          document.querySelector('.btn-fechar-previa') ||
                          document.querySelector('[data-acao="cancelar-previa"]');

  if (btnFecharPrevia && btnFecharPrevia.offsetParent !== null) {
    btnFecharPrevia.click();
    falarTexto('Fechado. Rota cancelada.');
    return;
  }

  const btnDispensa = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
  if (btnDispensa) {
    btnDispensa.click();
    falarTexto('Chamada dispensada.');
    return;
  }

  const btnFecharModal = document.getElementById('btnFecharModalEdicao') ||
                         document.getElementById('btnFecharDrawerPerfil');
  if (btnFecharModal && btnFecharModal.offsetParent !== null) {
    btnFecharModal.click();
    falarTexto('Pronto, fechado.');
    return;
  }

  falarTexto('Nada aberto para fechar agora.');
}

function cmdVerRotaNoMapa() {
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order') ||
                      document.querySelector('button.btn-accept-order');

  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada no radar pra ver.');
    return;
  }

  pararAlertaSonoroChamada();
  primeiroBtn.click();

  const dados = extrairDadosDoBotao(primeiroBtn);
  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const distNum = parseFloat(dados.dist || 0);
  const distTexto = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;

  falarTexto(`Rota na tela. Deu ${distTexto}, pagando ${repasse} reais. Quer que eu aceite?`);
}

function cmdAceitarChamada() {
  const btnModalConfirmar = document.getElementById('btnConfirmarAceiteViagem') || 
                            document.querySelector('button.btn-confirmar-aceite');

  if (btnModalConfirmar && btnModalConfirmar.offsetParent !== null) {
    falarTexto('Fechado, corrida aceita. Traçando rota.');
    btnModalConfirmar.click();
    return;
  }

  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (primeiroBtn) {
    const dados = extrairDadosDoBotao(primeiroBtn);
    preVisualizarRotaPedido(dados);
    setTimeout(() => {
      const btnModal = document.getElementById('btnConfirmarAceiteViagem');
      if (btnModal) {
        falarTexto('Fechado, corrida aceita.');
        btnModal.click();
      }
    }, 400);
    return;
  }

  falarTexto('Não tem nenhuma corrida no radar pra pegar.');
}

function cmdAvisarChegada() {
  const btnNoLocal = document.getElementById('btnChegueiLocalEmbarque');
  if (btnNoLocal && btnNoLocal.offsetParent !== null) {
    falarTexto('Avisando o passageiro que você encostou.');
    btnNoLocal.click();
  } else {
    falarTexto('Você só pode avisar quando estiver perto do embarque.');
  }
}

function cmdIniciarViagem() {
  const btnIniciar = document.getElementById('btnIniciarCorridaAtiva');
  if (btnIniciar && btnIniciar.offsetParent !== null) {
    falarTexto('Partiu, viagem iniciada. Boa corrida.');
    btnIniciar.click();
  } else {
    falarTexto('Nenhuma corrida aguardando partida.');
  }
}

function cmdFinalizarViagem() {
  const btnConcluir = document.getElementById('btnConcluirCorrida');
  if (btnConcluir && btnConcluir.offsetParent !== null) {
    falarTexto('Corrida concluída. Abrindo acerto.');
    btnConcluir.click();
  } else {
    falarTexto('Nenhuma corrida ativa pra encerrar.');
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