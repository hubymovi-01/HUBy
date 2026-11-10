// js/ia/motorista-ia.js - Copiloto Hands-Free com Frase Personalizada, Suporte Gemini e Wake Lock
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

// ============================================================================
// 1. NORMALIZAÇÃO FONÉTICA E PALAVRA-CHAVE PERSONALIZADA
// ============================================================================
function normalizarTexto(txt = '') {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Recupera a frase de ativação cadastrada pelo condutor
export function obterCodigoAtivacaoMotorista() {
  const salvo = localStorage.getItem('huby_codigo_voz_motorista');
  return salvo && salvo.trim() ? salvo.trim() : 'OK HUBy';
}

// Grava a nova frase de ativação no storage e no banco PostgreSQL
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

  falarTexto(`Comando definido para: ${fraseLimpa}`);
  atualizarIndicadorUIVoz(escutaAtiva);
  return true;
}

// Resposta por voz (Text-to-Speech)
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

// ============================================================================
// 2. WAKE LOCK: TELA SEMPRE ATIVA AO VOLANTE
// ============================================================================
async function requisitarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (e) {
      console.warn('Wake Lock não concedido:', e.message);
    }
  }
}

function liberarWakeLock() {
  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release();
    } catch (e) {}
    wakeLockSentinel = null;
  }
}

// ============================================================================
// 3. RECONHECIMENTO CONTÍNUO (HANDS-FREE)
// ============================================================================
export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Reconhecimento de fala indisponível no navegador.');
    return false;
  }

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
    if (escutaAtiva && (estado.isOnline || localStorage.getItem('huby_motorista_online') === 'true')) {
      try {
        recognition.start();
      } catch (e) {}
    } else {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error !== 'no-speech') {
      console.warn('Áudio copiloto info:', ev.error);
    }
  };

  recognition.onresult = (ev) => {
    const ultimoResultado = ev.results[ev.results.length - 1];
    if (!ultimoResultado || !ultimoResultado[0]) return;

    const transcricao = ultimoResultado[0].transcript;
    processarComandoVoz(transcricao);
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

// ============================================================================
// 4. PROCESSAMENTO DE INTENÇÃO E SUPORTE GEMINI
// ============================================================================
async function processarComandoVoz(fraseBruta) {
  if (processandoComando) return;

  const fraseFalada = normalizarTexto(fraseBruta);
  const gatilhoCadastrado = normalizarTexto(obterCodigoAtivacaoMotorista());

  // Checa se chamou pelo gatilho configurado
  if (!fraseFalada.includes(gatilhoCadastrado)) {
    const partePrincipal = gatilhoCadastrado.replace(/^(ok|ei|fala|e ai)\s+/i, '').trim();
    if (!partePrincipal || !fraseFalada.includes(partePrincipal)) {
      return;
    }
  }

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 1200);

  let acao = fraseFalada.replace(gatilhoCadastrado, '').trim();

  // 1. CHECAR OU VER A ROTA DA CORRIDA NO MAPA
  if (
    acao.includes('ver') || 
    acao.includes('checar') || 
    acao.includes('olhar') || 
    acao.includes('mostrar') || 
    acao.includes('rota') || 
    acao.includes('pedido') ||
    acao.includes('chamada')
  ) {
    cmdVerRotaNoMapa();
    return;
  }

  // 2. ACEITAR / CONFIRMAR CORRIDA
  if (
    acao.includes('aceitar') || 
    acao.includes('confirmar') || 
    acao.includes('pegar') || 
    acao.includes('vou fazer') || 
    acao.includes('sim')
  ) {
    cmdAceitarChamada();
    return;
  }

  // 3. RECUSAR / DISPENSAR CHAMADA
  if (
    acao.includes('recusar') || 
    acao.includes('dispensar') || 
    acao.includes('ignorar') || 
    acao.includes('passo') || 
    acao.includes('nao')
  ) {
    cmdDispensarChamada();
    return;
  }

  // 4. AVISAR CHEGADA AO EMBARQUE
  if (acao.includes('cheguei') || acao.includes('no local') || acao.includes('estou aqui')) {
    cmdAvisarChegada();
    return;
  }

  // 5. INICIAR VIAGEM COM PASSAGEIRO
  if (acao.includes('iniciar') || acao.includes('embarcou') || acao.includes('partiu')) {
    cmdIniciarViagem();
    return;
  }

  // 6. FINALIZAR CORRIDA
  if (acao.includes('finalizar') || acao.includes('concluir') || acao.includes('terminar')) {
    cmdFinalizarViagem();
    return;
  }

  // 7. CANAL DE SUPORTE E DÚVIDAS COM GEMINI (Perguntas Livres ao Volante)
  if (acao.length > 3) {
    await responderDuvidaComGemini(fraseBruta);
    return;
  }

  falarTexto('Às ordens.');
}

// Consulta de suporte em tempo real ao modelo Gemini
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
        contextoCorrida: {
          online: estado.isOnline,
          pedidoAtivoId: estado.pedidoAtivoId || null
        }
      })
    });

    const data = await resp.json().catch(() => null);
    if (data && data.resposta) {
      falarTexto(data.resposta);
    } else {
      falarTexto('Copiloto conectado. Como posso ajudar?');
    }
  } catch (err) {
    falarTexto('Estou a postos no trajeto.');
  }
}

// ============================================================================
// 5. AÇÕES EXECUTÁVEIS DIRETAS
// ============================================================================
function cmdVerRotaNoMapa() {
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada no radar agora.');
    return;
  }

  pararAlertaSonoroChamada();
  const dados = extrairDadosDoBotao(primeiroBtn);
  
  preVisualizarRotaPedido(dados);

  const repasse = dados.repasse || (Number(dados.preco) * 0.85).toFixed(2).replace('.', ',');
  const destinoLimpo = dados.destino ? dados.destino.split(',')[0] : 'destino';
  const gatilho = obterCodigoAtivacaoMotorista();

  falarTexto(`Rota na tela. Ganho de ${repasse} reais para ${destinoLimpo}. Diga ${gatilho} aceitar para confirmar.`);
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
        falarTexto('Viagem aceita. Traçando trajeto até o passageiro.');
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
    falarTexto('Comando disponível apenas próximo ao embarque.');
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

// ============================================================================
// 6. BADGE VISUAL DE STATUS DO COPILOTO
// ============================================================================
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