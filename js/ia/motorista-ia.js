// js/ia/motorista-ia.js - Controle Total da Área do Motorista por Voz e IA
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada, alternarStatusOnline } from '../motorista/motorista-radar.js';
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

  falarTexto(`Comando definido para: ${fraseLimpa}`);
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

// ============================================================================
// INSPEÇÃO TOTAL DA ÁREA DO MOTORISTA EM TEMPO REAL
// ============================================================================
function capturarContextoCompletoApp() {
  // Dados de Saldo e Finanças
  const saldoElement = document.getElementById('saldoCarteiraValor') || document.getElementById('drawerSaldoValor');
  const saldo = saldoElement ? saldoElement.textContent.trim() : 'R$ 0,00';
  const ganhosHoje = document.getElementById('lblGanhosHojeValor')?.textContent.trim() || 'R$ 0,00';
  const corridasHoje = document.getElementById('lblCorridasHojeQtd')?.textContent.trim() || '0 viagens';
  const metaDiaria = document.getElementById('lblMetaDiariaTxt')?.textContent.trim() || '';

  // Dados do Motorista e Veículo
  const nomeCondutor = document.getElementById('drawerNomeCondutor')?.textContent.trim() || 'Condutor';
  const modeloVeiculo = document.getElementById('drawerCarroModelo')?.textContent.trim() || '';
  const placaVeiculo = document.getElementById('drawerCarroPlaca')?.textContent.trim() || '';
  const detalhesVeiculo = document.getElementById('drawerCarroDetalhes')?.textContent.trim() || '';
  const avaliacao = document.getElementById('drawerAvaliacaoTxt')?.textContent.trim() || '5.0';

  // Radar e Chamadas
  const cardsChamadas = document.querySelectorAll('#listaChamadasPendentes .btn-accept-order');
  const qtdChamadas = cardsChamadas.length;
  let dadosPrimeiraChamada = null;
  if (qtdChamadas > 0) {
    dadosPrimeiraChamada = extrairDadosDoBotao(cardsChamadas[0]);
  }

  // Modais abertos e Telas
  const previaAberta = Boolean(document.getElementById('modalPreviaRotaCorrida')?.offsetParent || document.getElementById('btnConfirmarAceiteViagem')?.offsetParent);
  const modalPagamentoAberto = Boolean(document.getElementById('modalEscolhaPagamentoMotorista')?.offsetParent);
  const modalSaqueAberto = Boolean(document.getElementById('modalSaquePix')?.offsetParent);
  const drawerAberto = Boolean(document.getElementById('driverDrawer')?.classList.contains('active'));

  return {
    statusOnline: estado.isOnline,
    saldo,
    ganhosHoje,
    corridasHoje,
    metaDiaria,
    nomeCondutor,
    veiculo: `${modeloVeiculo} (${detalhesVeiculo}) placa ${placaVeiculo}`,
    avaliacao,
    qtdChamadasNoRadar: qtdChamadas,
    primeiraChamadaRadar: dadosPrimeiraChamada,
    corridaAtivaId: estado.pedidoAtivoId || null,
    telasAbertas: {
      previaRota: previaAberta,
      pagamento: modalPagamentoAberto,
      saquePix: modalSaqueAberto,
      drawerPerfil: drawerAberto
    }
  };
}

// ============================================================================
// ESCUTA CONTÍNUA
// ============================================================================
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
      console.warn('Status áudio:', ev.error);
    }
  };

  recognition.onresult = (ev) => {
    const ultimo = ev.results[ev.results.length - 1];
    if (!ultimo || !ultimo[0]) return;
    processarComandoTotal(ultimo[0].transcript);
  };

  return true;
}

export function ativarEscutaCopiloto() {
  escutaDesejada = true;
  if (!recognition) inicializarCopilotoVoz();

  try {
    recognition.start();
    const comandoAtual = obterCodigoAtivacaoMotorista();
    notificar(`Copiloto ativo. Diga "${comandoAtual}"`, 'info', 2500);
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

// ============================================================================
// PROCESSADOR DE CONTROLE TOTAL (AÇÕES DIRETAS + GEMINI CONTEXTUAL)
// ============================================================================
async function processarComandoTotal(fraseBruta) {
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

  if (!gatilhoDetectado && !copilotoAguardandoComando) return;

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 900);

  let acao = fraseFalada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b${palavraChavePrincipal}\\b`, 'gi'), '')
    .replace(/^(ok|ei|fala|e ai)\s+/i, '')
    .trim();

  // Chamou apenas a ativação
  if (acao.length === 0 || acao === 'ola' || acao === 'opa') {
    copilotoAguardandoComando = true;
    if (timeoutJanelaComando) clearTimeout(timeoutJanelaComando);
    timeoutJanelaComando = setTimeout(() => { copilotoAguardandoComando = false; }, 8000);
    falarTexto('Estou ouvindo. Pode pedir.');
    return;
  }

  copilotoAguardandoComando = false;

  // -------------------------------------------------------------
  // AÇÕES DIRETAS DE HARDWARE E INTERFACE (DISPARO INSTANTÂNEO)
  // -------------------------------------------------------------

  // 1. VISUALIZAR ROTA NO MAPA
  if (
    acao.includes('visualizar') || acao.includes('ver rota') || acao.includes('mostrar rota') ||
    acao.includes('olhar rota') || acao.includes('abrir rota') || acao.includes('mostrar trajeto') ||
    acao.includes('ver corrida')
  ) {
    cmdVerRotaNoMapa();
    return;
  }

  // 2. ACEITAR CORRIDA
  if (
    acao.includes('aceitar') || acao.includes('confirmar corrida') ||
    acao.includes('pegar corrida') || acao.includes('vou fazer') || acao.includes('pode aceitar')
  ) {
    cmdAceitarChamada();
    return;
  }

  // 3. RECUSAR / DISPENSAR CHAMADA
  if (acao.includes('recusar') || acao.includes('dispensar') || acao.includes('ignorar') || acao.includes('passar')) {
    cmdDispensarChamada();
    return;
  }

  // 4. DISTÂNCIA / QUILÔMETROS / TEMPO
  if (
    acao.includes('quantos km') || acao.includes('quantos quilometros') ||
    acao.includes('qual a distancia') || acao.includes('distancia') ||
    acao.includes('quanto tempo')
  ) {
    cmdInformarDistanciaETempo();
    return;
  }

  // 5. CHECAR RADAR
  if (acao.includes('tem rota') || acao.includes('tem corrida') || acao.includes('tem chamada') || acao.includes('alguma corrida')) {
    cmdChecarRadarStatus();
    return;
  }

  // 6. CHEGADA AO EMBARQUE
  if (acao.includes('cheguei') || acao.includes('no local') || acao.includes('estou aqui')) {
    cmdAvisarChegada();
    return;
  }

  // 7. INICIAR VIAGEM
  if (acao.includes('iniciar viagem') || acao.includes('iniciar corrida') || acao.includes('embarcou') || acao.includes('partiu')) {
    cmdIniciarViagem();
    return;
  }

  // 8. FINALIZAR CORRIDA
  if (acao.includes('finalizar') || acao.includes('concluir viagem') || acao.includes('terminar')) {
    cmdFinalizarViagem();
    return;
  }

  // 9. STATUS ONLINE / OFFLINE
  if (acao.includes('ficar offline') || acao.includes('desconectar') || acao.includes('desligar')) {
    if (estado.isOnline) {
      document.getElementById('btnToggleStatusOnline')?.click();
      falarTexto('Ficando offline.');
    } else {
      falarTexto('Você já está offline.');
    }
    return;
  }

  // 10. ABRIR / FECHAR PERFIL E DRAWER
  if (acao.includes('abrir perfil') || acao.includes('meu perfil') || acao.includes('abrir menu')) {
    document.getElementById('btnAbrirDrawerPerfil')?.click();
    falarTexto('Menu aberto.');
    return;
  }

  if (acao.includes('fechar perfil') || acao.includes('fechar menu') || acao.includes('voltar')) {
    document.getElementById('btnFecharDrawerPerfil')?.click();
    document.getElementById('btnFecharModalEdicao')?.click();
    falarTexto('Fechado.');
    return;
  }

  // 11. SOLICITAR SAQUE PIX
  if (acao.includes('sacar') || acao.includes('saque') || acao.includes('pedir saque')) {
    const btnSaque = document.getElementById('btnAbrirModalSaque');
    if (btnSaque) {
      btnSaque.click();
      const saldo = document.getElementById('saldoCarteiraValor')?.textContent || '0 reais';
      falarTexto(`Tela de saque aberta. Seu saldo disponível é de ${saldo}.`);
      return;
    }
  }

  // 12. MODO PAUSA
  if (acao.includes('pausa') || acao.includes('parada') || acao.includes('abastecer')) {
    const btnPausa = document.getElementById('btnModoPausa');
    if (btnPausa) {
      btnPausa.click();
      falarTexto('Modo pausa acionado.');
      return;
    }
  }

  // 13. MAPA DE CALOR
  if (acao.includes('mapa de calor') || acao.includes('onde tem corrida') || acao.includes('calor')) {
    const btnCalor = document.getElementById('btnToggleHeatmap');
    if (btnCalor) {
      btnCalor.click();
      falarTexto('Exibindo zonas de alta demanda no mapa.');
      return;
    }
  }

  // 14. LOJA / BENEFÍCIOS
  if (acao.includes('loja') || acao.includes('clube') || acao.includes('desconto')) {
    const btnLoja = document.getElementById('btnAbrirMarketplaceDrawer');
    if (btnLoja) {
      btnLoja.click();
      falarTexto('Abrindo Clube de vantagens HUBy.');
      return;
    }
  }

  // -------------------------------------------------------------
  // CONSULTAS GERAIS, SALDO, PERGUNTAS E CONTROLE POR IA (GEMINI)
  // -------------------------------------------------------------
  await responderQualquerPerguntaComGemini(fraseBruta);
}

// Responde a qualquer pergunta usando o contexto da tela
async function responderQualquerPerguntaComGemini(perguntaCompleta) {
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
    if (data && data.resposta) {
      falarTexto(data.resposta);
    } else {
      falarTexto('Copiloto a postos. Como posso ajudar agora?');
    }
  } catch (err) {
    // Respostas de contingência local se o servidor demorar
    const textoBaixo = normalizarTexto(perguntaCompleta);
    if (textoBaixo.includes('saldo') || textoBaixo.includes('carteira')) {
      falarTexto(`Seu saldo atual é de ${contexto.saldo}.`);
    } else if (textoBaixo.includes('ganho') || textoBaixo.includes('hoje')) {
      falarTexto(`Hoje você fez ${contexto.ganhosHoje} em ${contexto.corridasHoje}.`);
    } else if (textoBaixo.includes('placa') || textoBaixo.includes('carro')) {
      falarTexto(`Seu veículo cadastrado é o ${contexto.veiculo}.`);
    } else {
      falarTexto('Comando recebido. Estou monitorando o trajeto.');
    }
  }
}

// -------------------------------------------------------------
// FUNÇÕES DE AÇÕES DIRETAS
// -------------------------------------------------------------
function cmdVerRotaNoMapa() {
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order') ||
                      document.querySelector('button.btn-accept-order');

  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada pendente no momento para visualizar.');
    return;
  }

  pararAlertaSonoroChamada();
  primeiroBtn.click();

  const dados = extrairDadosDoBotao(primeiroBtn);
  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const distNum = parseFloat(dados.dist || 0);
  const distTexto = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Visualizando rota no mapa. Distância de ${distTexto}, ganho de ${repasse} reais. Diga ${gatilho} aceitar para confirmar.`);
}

function cmdInformarDistanciaETempo() {
  let kmEncontrado = null;
  let tempoEncontrado = null;

  const spans = document.querySelectorAll('span, small, div');
  for (const s of spans) {
    const texto = s.textContent || '';
    if (texto.includes('km') && !kmEncontrado) {
      const matchKm = texto.match(/([0-9]+[.,]?[0-9]*)\s*km/i);
      if (matchKm) kmEncontrado = matchKm[1].replace(',', '.');
    }
    if ((texto.includes('min') || texto.includes('minutos')) && !tempoEncontrado) {
      const matchMin = texto.match(/([0-9]+)\s*min/i);
      if (matchMin) tempoEncontrado = matchMin[1];
    }
  }

  if (!kmEncontrado) {
    const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
    if (primeiroBtn) {
      kmEncontrado = primeiroBtn.getAttribute('data-dist') || primeiroBtn.getAttribute('data-km');
      tempoEncontrado = primeiroBtn.getAttribute('data-dur');
    }
  }

  if (kmEncontrado) {
    const kmNum = parseFloat(kmEncontrado);
    const kmFormatado = kmNum < 1 ? `${Math.round(kmNum * 1000)} metros` : `${kmNum.toFixed(1).replace('.', ',')} quilômetros`;
    const tempoTexto = tempoEncontrado ? ` e cerca de ${tempoEncontrado} minutos` : '';
    falarTexto(`Essa rota tem ${kmFormatado}${tempoTexto}.`);
  } else {
    falarTexto('Nenhuma corrida aberta na tela para calcular distância.');
  }
}

function cmdChecarRadarStatus() {
  const chamadas = document.querySelectorAll('#listaChamadasPendentes .btn-accept-order');
  if (!chamadas || chamadas.length === 0) {
    falarTexto('Nenhuma chamada no radar no momento. Estou monitorando.');
    return;
  }

  const primeiroBtn = chamadas[0];
  const dados = extrairDadosDoBotao(primeiroBtn);
  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const destinoLimpo = dados.destino ? dados.destino.split(',')[0] : 'destino';
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Temos uma chamada para ${destinoLimpo}, ganho de ${repasse} reais. Diga ${gatilho} visualizar para ver a rota.`);
}

function cmdAceitarChamada() {
  const btnModalConfirmar = document.getElementById('btnConfirmarAceiteViagem') || 
                            document.querySelector('button.btn-confirmar-aceite');

  if (btnModalConfirmar && btnModalConfirmar.offsetParent !== null) {
    falarTexto('Corrida aceita. Traçando trajeto até o passageiro.');
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
        falarTexto('Corrida aceita. Traçando trajeto até o passageiro.');
        btnModal.click();
      }
    }, 400);
    return;
  }

  falarTexto('Nenhuma chamada no radar para aceitar.');
}

function cmdDispensarChamada() {
  const btnFecharModal = document.getElementById('btnCancelarPreviaRota');
  if (btnFecharModal && btnFecharModal.offsetParent !== null) {
    btnFecharModal.click();
    falarTexto('Rota dispensada.');
    return;
  }

  const primeiroDispensa = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
  if (primeiroDispensa) {
    primeiroDispensa.click();
    falarTexto('Dispensada.');
  } else {
    falarTexto('Nenhuma chamada no radar.');
  }
}

function cmdAvisarChegada() {
  const btnNoLocal = document.getElementById('btnChegueiLocalEmbarque');
  if (btnNoLocal && btnNoLocal.offsetParent !== null) {
    falarTexto('Passageiro avisado que você chegou.');
    btnNoLocal.click();
  } else {
    falarTexto('Disponível apenas próximo ao local de embarque.');
  }
}

function cmdIniciarViagem() {
  const btnIniciar = document.getElementById('btnIniciarCorridaAtiva');
  if (btnIniciar && btnIniciar.offsetParent !== null) {
    falarTexto('Viagem iniciada. Boa corrida.');
    btnIniciar.click();
  } else {
    falarTexto('Nenhuma corrida aguardando início.');
  }
}

function cmdFinalizarViagem() {
  const btnConcluir = document.getElementById('btnConcluirCorrida');
  if (btnConcluir && btnConcluir.offsetParent !== null) {
    falarTexto('Abrindo recebimento.');
    btnConcluir.click();
  } else {
    falarTexto('Nenhuma viagem ativa para finalizar.');
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
    badge.innerHTML = `🎙️ "${gatilho}" Ativo`;
  } else {
    badge.style.background = 'rgba(15, 23, 42, 0.85)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    badge.style.color = '#94A3B8';
    badge.innerHTML = `🎙️ "${gatilho}" Pausado`;
  }
}