// js/ia/motorista-ia.js - Assistente Copiloto Hands-Free com Código Pessoal por Voz HUBy
import { estado } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada } from '../motorista/motorista-radar.js';
import { preVisualizarRotaPedido, aceitarCorridaSelecionada } from '../motorista/motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaAtiva = false;
let sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;

// ============================================================================
// AUXILIARES: NORMALIZAÇÃO DE TEXTO E CÓDIGO PESSOAL
// ============================================================================
function normalizarTexto(txt = '') {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function obterCodigoAtivacaoMotorista() {
  const salvo = localStorage.getItem('huby_codigo_voz_motorista');
  return salvo && salvo.trim() ? salvo.trim() : 'Zank';
}

export function definirCodigoAtivacaoMotorista(novoCodigo) {
  if (!novoCodigo || !novoCodigo.trim()) return false;
  localStorage.setItem('huby_codigo_voz_motorista', novoCodigo.trim());
  falarTexto(`Código de ativação atualizado para ${novoCodigo.trim()}`);
  return true;
}

// Resposta por voz (Text-To-Speech)
export function falarTexto(texto) {
  if (!sintetizador) return;
  try {
    sintetizador.cancel();
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 1.05;
    utter.pitch = 1.0;
    sintetizador.speak(utter);
  } catch (err) {
    console.warn('Falha no sintetizador de voz:', err);
  }
}

// ============================================================================
// MOTOR DE RECONHECIMENTO CONTÍNUO (HANDS-FREE)
// ============================================================================
export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Navegador sem suporte a Web Speech API.');
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
    // Mantém a escuta contínua se o motorista estiver online e o recurso ativado
    if (escutaAtiva && estado.isOnline) {
      try {
        recognition.start();
      } catch (e) {}
    } else {
      atualizarIndicadorUIVoz(false);
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error !== 'no-speech') {
      console.warn('Aviso microfone copiloto:', ev.error);
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
    notificar(`Copiloto ativado. Chame por "${codigo}"`, 'info', 3000);
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
// PROCESSAMENTO DO COMANDO DE VOZ COM O CÓDIGO PESSOAL
// ============================================================================
function processarComandoVoz(fraseBruta) {
  const frase = normalizarTexto(fraseBruta);
  const codigoPessoal = normalizarTexto(obterCodigoAtivacaoMotorista());

  // Só prossegue se a frase contiver o código pessoal cadastrado
  if (!frase.includes(codigoPessoal)) {
    return;
  }

  // Remove o código de ativação para isolar o comando
  const comando = frase.replace(codigoPessoal, '').trim();

  // 1. CHECAR / VER CHAMADA
  if (comando.includes('checar') || comando.includes('ver') || comando.includes('olhar') || comando.includes('detalhes')) {
    executarChecagemPrimeiraChamada();
    return;
  }

  // 2. CONFIRMAR / ACEITAR
  if (comando.includes('confirmar') || comando.includes('aceitar') || comando.includes('fazer') || comando.includes('pode')) {
    executarAceiteChamadaAtiva();
    return;
  }

  // 3. RECUSAR / DISPENSAR
  if (comando.includes('recusar') || comando.includes('dispensar') || comando.includes('ignorar') || comando.includes('cancelar')) {
    executarDispensaChamada();
    return;
  }

  // 4. FINALIZAR CORRIDA
  if (comando.includes('finalizar') || comando.includes('concluir') || comando.includes('terminar')) {
    const btnConcluir = document.getElementById('btnConcluirCorrida');
    if (btnConcluir) {
      falarTexto('Abrindo opções de pagamento da corrida.');
      btnConcluir.click();
    }
    return;
  }

  // Resposta padrão caso apenas chame o código
  falarTexto(`Sim, comando ${obterCodigoAtivacaoMotorista()} a postos.`);
}

// Ações concretas disparadas por voz
function executarChecagemPrimeiraChamada() {
  const primeiroCard = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (!primeiroCard) {
    falarTexto('Nenhuma chamada pendente no momento.');
    return;
  }

  pararAlertaSonoroChamada();
  const dados = extrairDadosDoBotao(primeiroCard);
  preVisualizarRotaPedido(dados);

  const valor = dados.preco ? `no valor de R$ ${Number(dados.preco).toFixed(2).replace('.', ',')}` : '';
  const destino = dados.destino ? `com destino para ${dados.destino}` : '';
  falarTexto(`Viagem checada ${valor} ${destino}. Para confirmar, diga: ${obterCodigoAtivacaoMotorista()} confirmar.`);
}

function executarAceiteChamadaAtiva() {
  const btnConfirmarModal = document.getElementById('btnConfirmarAceiteViagem');
  if (btnConfirmarModal && btnConfirmarModal.offsetParent !== null) {
    falarTexto('Confirmando viagem.');
    btnConfirmarModal.click();
    return;
  }

  const primeiroCard = document.querySelector('#listaChamadasPendentes .btn-accept-order');
  if (primeiroCard) {
    const dados = extrairDadosDoBotao(primeiroCard);
    preVisualizarRotaPedido(dados);
    setTimeout(() => {
      const btnModal = document.getElementById('btnConfirmarAceiteViagem');
      if (btnModal) {
        falarTexto('Viagem aceita com sucesso. Traçando rota.');
        btnModal.click();
      }
    }, 400);
    return;
  }

  falarTexto('Nenhuma viagem pronta para confirmação.');
}

function executarDispensaChamada() {
  const btnFecharModal = document.getElementById('btnCancelarPreviaRota');
  if (btnFecharModal && btnFecharModal.offsetParent !== null) {
    btnFecharModal.click();
    falarTexto('Chamada dispensada.');
    return;
  }

  const primeiroDispensa = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
  if (primeiroDispensa) {
    primeiroDispensa.click();
    falarTexto('Chamada dispensada do radar.');
  }
}

function atualizarIndicadorUIVoz(ativo) {
  let badge = document.getElementById('badgeCopilotoVozStatus');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'badgeCopilotoVozStatus';
    badge.style.position = 'fixed';
    badge.style.bottom = '18px';
    badge.style.right = '18px';
    badge.style.zIndex = '9999';
    badge.style.padding = '8px 12px';
    badge.style.borderRadius = '20px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '800';
    badge.style.backdropFilter = 'blur(10px)';
    badge.style.transition = 'all 0.3s ease';
    document.body.appendChild(badge);
  }

  const cod = obterCodigoAtivacaoMotorista();
  if (ativo) {
    badge.style.background = 'rgba(16, 185, 129, 0.2)';
    badge.style.border = '1px solid #10B981';
    badge.style.color = '#10B981';
    badge.innerHTML = `🎙️ "${cod}" Ativo`;
  } else {
    badge.style.background = 'rgba(15, 23, 42, 0.7)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    badge.style.color = '#94A3B8';
    badge.innerHTML = `🎙️ "${cod}" Pausado`;
  }
}