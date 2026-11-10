// js/ia/motorista-ia.js - Assistente Copiloto Hands-Free Completo HUBy
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada } from '../motorista/motorista-radar.js';
import { preVisualizarRotaPedido } from '../motorista/motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaAtiva = false;
let sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;
let processandoComando = false;

// ============================================================================
// 1. NORMALIZAÇÃO FONÉTICA E PALAVRA-CHAVE
// ============================================================================
function normalizarTexto(txt = '') {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

export function obterCodigoAtivacaoMotorista() {
  const salvo = localStorage.getItem('huby_codigo_voz_motorista');
  return salvo && salvo.trim() ? salvo.trim() : 'Zank';
}

export async function definirCodigoAtivacaoMotorista(novoCodigo) {
  if (!novoCodigo || !novoCodigo.trim()) return false;
  const codLimpo = novoCodigo.trim();
  localStorage.setItem('huby_codigo_voz_motorista', codLimpo);

  // Sincroniza com o servidor se estiver autenticado
  try {
    await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ codigo_voz: codLimpo })
    });
  } catch (e) {
    console.warn('Persistência local mantida para o código de voz');
  }

  falarTexto(`Código atualizado para ${codLimpo}`);
  atualizarIndicadorUIVoz(escutaAtiva);
  return true;
}

// Resposta por voz ultra-rápida (menos de 2s)
export function falarTexto(texto) {
  if (!sintetizador) return;
  try {
    sintetizador.cancel();
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 1.15; // Fala ligeiramente acelerada para não atrasar a condução
    utter.pitch = 1.0;
    sintetizador.speak(utter);
  } catch (err) {
    console.warn('Falha no sintetizador:', err);
  }
}

// ============================================================================
// 2. MOTOR DE RECONHECIMENTO CONTÍNUO (HANDS-FREE)
// ============================================================================
export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Navegador sem suporte à API de reconhecimento de voz.');
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
  };

  recognition.onend = () => {
    // Reativa escuta automática contínua se o motorista estiver online
    if (escutaAtiva && (estado.isOnline || localStorage.getItem('huby_motorista_online') === 'true')) {
      try {
        recognition.start();
      } catch (e) {}
    } else {
      atualizarIndicadorUIVoz(false);
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error !== 'no-speech') {
      console.warn('Copiloto áudio info:', ev.error);
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
    const codigo = obterCodigoAtivacaoMotorista();
    notificar(`Copiloto ativo. Diga "${codigo}"`, 'info', 2800);
  } catch (e) {}
}

export function desativarEscutaCopiloto() {
  escutaAtiva = false;
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  atualizarIndicadorUIVoz(false);
}

// ============================================================================
// 3. PROCESSAMENTO DO DICIONÁRIO COMPLETO DE COMANDOS
// ============================================================================
function processarComandoVoz(fraseBruta) {
  if (processandoComando) return;
  const frase = normalizarTexto(fraseBruta);
  const codigoPessoal = normalizarTexto(obterCodigoAtivacaoMotorista());

  // Só responde se houver a palavra-chave no texto falado
  if (!frase.includes(codigoPessoal)) {
    return;
  }

  processandoComando = true;
  setTimeout(() => { processandoComando = false; }, 1200);

  const comando = frase.replace(codigoPessoal, '').trim();

  // 1. CHECAR / VER CHAMADA
  if (comando.includes('checar') || comando.includes('ver') || comando.includes('olhar') || comando.includes('detalhes')) {
    cmdChecarChamada();
    return;
  }

  // 2. ACEITAR / CONFIRMAR CORRIDA
  if (comando.includes('aceitar') || comando.includes('confirmar') || comando.includes('pegar') || comando.includes('fazer')) {
    cmdAceitarChamada();
    return;
  }

  // 3. RECUSAR / DISPENSAR
  if (comando.includes('recusar') || comando.includes('dispensar') || comando.includes('ignorar') || comando.includes('pular')) {
    cmdDispensarChamada();
    return;
  }

  // 4. CHEGUEI AO LOCAL DE EMBARQUE
  if (comando.includes('cheguei') || comando.includes('estou aqui') || comando.includes('no local')) {
    cmdAvisarChegada();
    return;
  }

  // 5. INICIAR VIAGEM COM PASSAGEIRO
  if (comando.includes('iniciar') || comando.includes('embarcou') || comando.includes('partiu')) {
    cmdIniciarViagem();
    return;
  }

  // 6. FINALIZAR CORRIDA
  if (comando.includes('finalizar') || comando.includes('concluir') || comando.includes('chegou') || comando.includes('terminar')) {
    cmdFinalizarViagem();
    return;
  }

  // Retorno caso só fale o código
  falarTexto(`Às ordens.`);
}

// ============================================================================
// 4. AÇÕES EXECUTÁVEIS DO COPILOTO
// ============================================================================
function cmdChecarChamada() {
  const primeiroBtn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (!primeiroBtn) {
    falarTexto('Nenhuma chamada no radar.');
    return;
  }

  pararAlertaSonoroChamada();
  const dados = extrairDadosDoBotao(primeiroBtn);
  preVisualizarRotaPedido(dados);

  const valLiq = dados.preco ? (Number(dados.preco) * 0.85).toFixed(2).replace('.', ',') : '';
  const valorFala = valLiq ? `ganho de ${valLiq} reais` : '';
  const destinoFala = dados.destino ? `para ${dados.destino}` : '';

  falarTexto(`Viagem ${valorFala} ${destinoFala}. Diga aceitar para confirmar.`);
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
        falarTexto('Viagem aceita. Traçando rota.');
        btnModal.click();
      }
    }, 350);
    return;
  }

  falarTexto('Nenhuma chamada para aceitar.');
}

function cmdDispensarChamada() {
  const btnFecharModal = document.getElementById('btnCancelarPreviaRota');
  if (btnFecharModal && btnFecharModal.offsetParent !== null) {
    btnFecharModal.click();
    falarTexto('Chamada dispensada.');
    return;
  }

  const primeiroDispensa = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
  if (primeiroDispensa) {
    primeiroDispensa.click();
    falarTexto('Dispensada.');
  } else {
    falarTexto('Nada para dispensar.');
  }
}

function cmdAvisarChegada() {
  const btnNoLocal = document.getElementById('btnChegueiLocalEmbarque');
  if (btnNoLocal && btnNoLocal.offsetParent !== null) {
    falarTexto('Passageiro avisado que você chegou.');
    btnNoLocal.click();
  } else {
    falarTexto('Comando disponível apenas ao aproximar do embarque.');
  }
}

function cmdIniciarViagem() {
  const btnIniciar = document.getElementById('btnIniciarCorridaAtiva');
  if (btnIniciar && btnIniciar.offsetParent !== null) {
    falarTexto('Viagem iniciada. Dirija com cuidado.');
    btnIniciar.click();
  } else {
    falarTexto('Não há corrida aguardando início.');
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
// 5. BADGE VISUAL DE STATUS DO MICROFONE
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

  const cod = obterCodigoAtivacaoMotorista();
  if (ativo) {
    badge.style.background = 'rgba(16, 185, 129, 0.22)';
    badge.style.border = '1px solid #10B981';
    badge.style.color = '#10B981';
    badge.innerHTML = `🎙️ Copiloto: "${cod}"`;
  } else {
    badge.style.background = 'rgba(15, 23, 42, 0.85)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    badge.style.color = '#94A3B8';
    badge.innerHTML = `🎙️ "${cod}" Pausado`;
  }
}