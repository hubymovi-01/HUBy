// js/ia/motorista-ia.js - Copiloto Hands-Free com Ações Rápidas, Leitura de Km e Visualização de Rota
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

// Mantém a IA atenta por 8 segundos após falar "Ok Zanix" para aceitar comandos soltos (ex: "Visualizar")
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
    processarComandoVoz(ultimo[0].transcript);
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

async function processarComandoVoz(fraseBruta) {
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

  // Se o condutor não chamou pelo nome e a janela de escuta anterior não estiver aberta, ignora
  if (!gatilhoDetectado && !copilotoAguardandoComando) return;

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 1000);

  let acao = fraseFalada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b${palavraChavePrincipal}\\b`, 'gi'), '')
    .replace(/^(ok|ei|fala|e ai)\s+/i, '')
    .trim();

  // 1. DISTÂNCIA / QUILÔMETROS / TEMPO DA ROTA
  if (
    acao.includes('quantos km') || acao.includes('quantos quilometros') ||
    acao.includes('qual a distancia') || acao.includes('distancia') ||
    acao.includes('quanto tempo') || acao.includes('informacoes da rota')
  ) {
    copilotoAguardandoComando = false;
    cmdInformarDistanciaETempo();
    return;
  }

  // 2. VISUALIZAR ROTA NO MAPA (Aceita variações diretas)
  if (
    acao.includes('visualizar') || acao.includes('ver rota') || acao.includes('mostrar rota') ||
    acao.includes('olhar rota') || acao.includes('abrir mapa') || acao.includes('mostrar trajeto') ||
    acao.includes('ver trajeto') || acao.includes('exibir rota')
  ) {
    copilotoAguardandoComando = false;
    cmdVerRotaNoMapa();
    return;
  }

  // 3. CHECAR RADAR
  if (
    acao.includes('tem rota') || acao.includes('tem corrida') || acao.includes('tem chamada') ||
    acao.includes('alguma rota') || acao.includes('alguma corrida')
  ) {
    copilotoAguardandoComando = false;
    cmdChecarRadarStatus();
    return;
  }

  // 4. ACEITAR CORRIDA
  if (
    acao.includes('aceitar') || acao.includes('confirmar') || acao.includes('pegar') ||
    acao.includes('vou fazer') || acao.includes('pode aceitar')
  ) {
    copilotoAguardandoComando = false;
    cmdAceitarChamada();
    return;
  }

  // 5. RECUSAR / DISPENSAR
  if (acao.includes('recusar') || acao.includes('dispensar') || acao.includes('ignorar') || acao.includes('passo')) {
    copilotoAguardandoComando = false;
    cmdDispensarChamada();
    return;
  }

  // 6. CHEGADA AO EMBARQUE
  if (acao.includes('cheguei') || acao.includes('no local') || acao.includes('estou aqui')) {
    copilotoAguardandoComando = false;
    cmdAvisarChegada();
    return;
  }

  // 7. INICIAR VIAGEM
  if (acao.includes('iniciar') || acao.includes('embarcou') || acao.includes('partiu')) {
    copilotoAguardandoComando = false;
    cmdIniciarViagem();
    return;
  }

  // 8. FINALIZAR CORRIDA
  if (acao.includes('finalizar') || acao.includes('concluir') || acao.includes('terminar')) {
    copilotoAguardandoComando = false;
    cmdFinalizarViagem();
    return;
  }

  // Se ele chamou apenas o nome (ex: "Ok Zanix"), abre janela de 8 segundos para ouvir o comando solto
  if (acao.length === 0 || acao === 'olá' || acao === 'ola') {
    copilotoAguardandoComando = true;
    if (timeoutJanelaComando) clearTimeout(timeoutJanelaComando);
    timeoutJanelaComando = setTimeout(() => {
      copilotoAguardandoComando = false;
    }, 8000);

    falarTexto('Estou ouvindo. Pode falar.');
    return;
  }

  // 9. DÚVIDA LIVRE AO VOLANTE (GEMINI)
  if (acao.length > 3) {
    copilotoAguardandoComando = false;
    await responderDuvidaComGemini(fraseBruta);
    return;
  }

  falarTexto('Estou a postos.');
}

// INFORMAR QUILOMETRAGEM E TEMPO DA ROTA
function cmdInformarDistanciaETempo() {
  // 1. Tenta ler do card em análise de rota aberta
  const modalPrevia = document.getElementById('modalPreviaRotaCorrida') || document.querySelector('.rota-em-analise');
  const cardRotaAnalise = document.querySelector('[style*="ROTA EM ANÁLISE"]') || document.body;

  let kmEncontrado = null;
  let tempoEncontrado = null;

  // Busca em elementos com dados de km
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

  // Se não encontrou no texto, tenta no botão do radar
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
    falarTexto('Não identifiquei nenhuma rota aberta no momento.');
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

  falarTexto(`Temos uma chamada para ${destinoLimpo}, seu ganho é de ${repasse} reais. Diga ${gatilho} visualizar para ver a rota.`);
}

function cmdVerRotaNoMapa() {
  // Procura pelo botão verde de visualizar rota no card
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order') ||
                      document.querySelector('button.btn-accept-order');

  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada pendente no momento para visualizar.');
    return;
  }

  pararAlertaSonoroChamada();
  
  // Executa o clique do botão verde para desenhar e abrir a rota
  primeiroBtn.click();

  const dados = extrairDadosDoBotao(primeiroBtn);
  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const distNum = parseFloat(dados.dist || 0);
  const distTexto = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Visualizando rota no mapa. Distância de ${distTexto}, ganho de ${repasse} reais. Diga ${gatilho} aceitar para confirmar.`);
}

function cmdAceitarChamada() {
  // 1. Se a prévia da rota já estiver aberta com o botão "Aceitar Corrida"
  const btnModalConfirmar = document.getElementById('btnConfirmarAceiteViagem') || 
                            document.querySelector('button.btn-confirmar-aceite') ||
                            document.querySelector('button:contains("Aceitar Corrida")');

  if (btnModalConfirmar && btnModalConfirmar.offsetParent !== null) {
    falarTexto('Corrida aceita. Traçando trajeto até o passageiro.');
    btnModalConfirmar.click();
    return;
  }

  // 2. Ou aceita direto pelo primeiro botão do radar
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

  falarTexto('Nenhuma chamada para aceitar.');
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
    falarTexto('Disponível apenas próximo ao embarque.');
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

async function responderDuvidaComGemini(perguntaCompleta) {
  falarTexto('Consultando...');
  try {
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...obterHeaders()
      },
      body: JSON.stringify({
        pergunta: perguntaCompleta,
        contextoCorrida: { online: estado.isOnline, pedidoAtivoId: estado.pedidoAtivoId || null }
      })
    });

    const data = await resp.json().catch(() => null);
    if (data && data.resposta) {
      falarTexto(data.resposta);
    } else {
      falarTexto('Copiloto conectado. Em que posso ajudar?');
    }
  } catch (err) {
    falarTexto('Estou a postos no trajeto.');
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