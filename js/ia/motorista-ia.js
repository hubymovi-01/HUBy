// js/ia/motorista-ia.js - Copiloto Hands-Free com Tolerância Fonética Ampliada
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada } from '../motorista/motorista-radar.js';
import { preVisualizarRotaPedido } from '../motorista/motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaAtiva = false;
let sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;
let processandoComando = false;
let wakeLockSentinel = null;

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
    console.warn('Persistência local mantida para o comando de ativação.');
  }

  falarTexto(`Comando ativado: ${fraseLimpa}`);
  atualizarIndicadorUIVoz(escutaAtiva);
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
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    escutaAtiva = true;
    atualizarIndicadorUIVoz(true);
    requisitarWakeLock();
  };

  recognition.onend = () => {
    const online = estado.isOnline || localStorage.getItem('huby_motorista_online') === 'true';
    if (escutaAtiva && online) {
      try { recognition.start(); } catch (e) {}
    } else {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onresult = (ev) => {
    const ultimoResultado = ev.results[ev.results.length - 1];
    if (!ultimoResultado || !ultimoResultado[0]) return;
    processarComandoVoz(ultimoResultado[0].transcript);
  };

  return true;
}

export function ativarEscutaCopiloto() {
  if (!recognition && !inicializarCopilotoVoz()) return;
  escutaAtiva = true;
  try {
    recognition.start();
    const comandoAtual = obterCodigoAtivacaoMotorista();
    notificar(`Copiloto ativo. Diga "${comandoAtual}"`, 'info', 2800);
  } catch (e) {}
}

export function desativarEscutaCopiloto() {
  escutaAtiva = false;
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

  if (!gatilhoDetectado) return;

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 1200);

  let acao = fraseFalada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b${palavraChavePrincipal}\\b`, 'gi'), '')
    .replace(/^(ok|ei|fala|e ai)\s+/i, '')
    .trim();

  // 1. CHECAGEM DE RADAR
  if (
    acao.includes('tem rota') || acao.includes('tem corrida') || acao.includes('tem chamada') ||
    acao.includes('alguma rota') || acao.includes('alguma corrida') || acao.includes('algum pedido')
  ) {
    cmdChecarRadarStatus();
    return;
  }

  // 2. VISUALIZAR ROTA NO MAPA
  if (
    acao.includes('ver rota') || acao.includes('visualizar') || acao.includes('mostrar rota') ||
    acao.includes('olhar rota') || acao.includes('ver corrida') || acao.includes('exibir')
  ) {
    cmdVerRotaNoMapa();
    return;
  }

  // 3. ACEITAR CORRIDA
  if (acao.includes('aceitar') || acao.includes('confirmar') || acao.includes('pegar') || acao.includes('vou fazer')) {
    cmdAceitarChamada();
    return;
  }

  // 4. RECUSAR / DISPENSAR
  if (acao.includes('recusar') || acao.includes('dispensar') || acao.includes('ignorar') || acao.includes('passo')) {
    cmdDispensarChamada();
    return;
  }

  // 5. CHEGOU AO EMBARQUE
  if (acao.includes('cheguei') || acao.includes('no local') || acao.includes('estou aqui')) {
    cmdAvisarChegada();
    return;
  }

  // 6. INICIAR VIAGEM
  if (acao.includes('iniciar') || acao.includes('embarcou') || acao.includes('partiu')) {
    cmdIniciarViagem();
    return;
  }

  // 7. FINALIZAR CORRIDA
  if (acao.includes('finalizar') || acao.includes('concluir') || acao.includes('terminar')) {
    cmdFinalizarViagem();
    return;
  }

  // 8. SUPORTE GEMINI
  if (acao.length > 3) {
    await responderDuvidaComGemini(fraseBruta);
    return;
  }

  falarTexto('Estou ouvindo. Pode falar.');
}

function cmdChecarRadarStatus() {
  const chamadas = document.querySelectorAll('#listaChamadasPendentes .btn-accept-order');
  if (!chamadas || chamadas.length === 0) {
    falarTexto('Nenhuma chamada no radar no momento. Monitorando.');
    return;
  }

  const primeiroBtn = chamadas[0];
  const dados = extrairDadosDoBotao(primeiroBtn);
  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const destinoLimpo = dados.destino ? dados.destino.split(',')[0] : 'destino';
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Temos 1 chamada disponível para ${destinoLimpo}, ganho de ${repasse} reais. Diga ${gatilho} visualizar ou ${gatilho} aceitar.`);
}

function cmdVerRotaNoMapa() {
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada pendente para visualizar.');
    return;
  }

  pararAlertaSonoroChamada();
  const dados = extrairDadosDoBotao(primeiroBtn);
  preVisualizarRotaPedido(dados);

  const repasse = dados.repasse || (Number(dados.preco || 0) * 0.85).toFixed(2).replace('.', ',');
  const destinoLimpo = dados.destino ? dados.destino.split(',')[0] : 'destino';
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Rota na tela. Ganho de ${repasse} reais para ${destinoLimpo}. Diga ${gatilho} aceitar.`);
}

function cmdAceitarChamada() {
  const btnModalConfirmar = document.getElementById('btnConfirmarAceiteViagem');
  if (btnModalConfirmar && btnModalConfirmar.offsetParent !== null) {
    falarTexto('Viagem aceita.');
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
        falarTexto('Viagem aceita. Traçando trajeto.');
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
    falarTexto('Passageiro avisado.');
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