// js/ia/motorista-ia.js - Copiloto Autônomo HUBy com Estabilização Anti-Loop e Controle Total
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { extrairDadosDoBotao, pararAlertaSonoroChamada, alternarStatusOnline, iniciarRadarChamadas } from '../motorista/motorista-radar.js';
import { 
  preVisualizarRotaPedido, 
  aceitarCorrida, 
  confirmarEmbarqueEIrAoDestino, 
  abrirModalOpcoesPagamento, 
  processarLiquidacao,
  fecharModaisPagamento
} from '../motorista/motorista-corrida.js';
import { exportarResumoDia } from '../motorista/motorista-carteira.js';
import { limparRotasMapa } from '../motorista/motorista-mapa.js';
import { pararMonitoramentoDesvios } from '../motorista/motorista-rotas.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaDesejada = false;
let reconhecimentoRodando = false;
let falandoAgora = false;
let processandoRequisicao = false;
let timeoutReinicio = null;
let wakeLockSentinel = null;

// Janela de conversa ativa: após chamar o copiloto, você pode continuar falando sem repetir o nome por 12s
let janelaConversaAtiva = false;
let timerJanelaConversa = null;

const sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;

function normalizarTexto(txt = '') {
  return String(txt || '')
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

  const matriz = Array.from({ length: len1 + 1 }, (_, i) => [i]);
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
  return salvo && salvo.trim() ? salvo.trim() : 'Zank';
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
  } catch (e) {}

  falarTexto(`Código de voz atualizado para ${fraseLimpa}.`);
  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

function renovarJanelaConversa(segundos = 12) {
  janelaConversaAtiva = true;
  if (timerJanelaConversa) clearTimeout(timerJanelaConversa);
  timerJanelaConversa = setTimeout(() => {
    janelaConversaAtiva = false;
  }, segundos * 1000);
}

// ============================================================================
// SINTETIZADOR DE VOZ SINCRONIZADO COM O MICROFONE (EVITA AUTO-ESCUTA E LOOP)
// ============================================================================
export function falarTexto(texto) {
  if (!texto) return;
  if (!sintetizador) {
    notificar(texto, 'info');
    return;
  }

  try {
    if (timeoutReinicio) {
      clearTimeout(timeoutReinicio);
      timeoutReinicio = null;
    }

    falandoAgora = true;

    // Pausa o microfone suavemente antes de falar para não ouvir a própria voz
    if (recognition && reconhecimentoRodando) {
      try { recognition.stop(); } catch (e) {}
    }

    sintetizador.cancel();
    const utter = new SpeechSynthesisUtterance(String(texto));
    utter.lang = 'pt-BR';
    utter.rate = 1.15;
    utter.pitch = 1.0;

    const finalizarFala = () => {
      falandoAgora = false;
      renovarJanelaConversa(12);
      agendarReinicioMicrofone(650);
    };

    utter.onend = finalizarFala;
    utter.onerror = finalizarFala;

    sintetizador.speak(utter);
  } catch (err) {
    falandoAgora = false;
    agendarReinicioMicrofone(650);
  }
}

async function requisitarWakeLock() {
  if ('wakeLock' in navigator && !wakeLockSentinel) {
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
// CONTROLE ESTÁVEL DO MICROFONE (ZERO LOOP DE ATIVAÇÃO/DESATIVAÇÃO)
// ============================================================================
function agendarReinicioMicrofone(delayMs = 700) {
  if (timeoutReinicio) {
    clearTimeout(timeoutReinicio);
    timeoutReinicio = null;
  }

  const online = estado.isOnline || estado.statusOnline || localStorage.getItem('huby_motorista_online') === 'true';
  if (!escutaDesejada || !online || falandoAgora) return;

  timeoutReinicio = setTimeout(() => {
    if (!escutaDesejada || falandoAgora || reconhecimentoRodando) return;
    if (!recognition) inicializarCopilotoVoz();
    try {
      recognition.start();
    } catch (e) {}
  }, delayMs);
}

export function inicializarCopilotoVoz() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  if (recognition) return true;

  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    reconhecimentoRodando = true;
    atualizarIndicadorUIVoz(true);
    requisitarWakeLock();
  };

  recognition.onend = () => {
    reconhecimentoRodando = false;
    const online = estado.isOnline || estado.statusOnline || localStorage.getItem('huby_motorista_online') === 'true';

    // Mantém o badge visual firme em "Ativo" enquanto o motorista estiver online, sem piscar
    if (escutaDesejada && online) {
      if (!falandoAgora) {
        agendarReinicioMicrofone(750);
      }
    } else {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      escutaDesejada = false;
      reconhecimentoRodando = false;
      atualizarIndicadorUIVoz(false);
      notificar('Permissão de microfone bloqueada no navegador.', 'alerta');
      return;
    }
    // Erros normais de silêncio ('no-speech' / 'aborted') são tratados silenciosamente pelo onend
  };

  recognition.onresult = (ev) => {
    if (falandoAgora) return;
    const ultimo = ev.results[ev.results.length - 1];
    if (!ultimo || !ultimo[0]) return;
    const transcricao = ultimo[0].transcript;
    if (transcricao && transcricao.trim()) {
      processarEntradaVoz(transcricao.trim());
    }
  };

  atualizarIndicadorUIVoz(false);
  return true;
}

export function ativarEscutaCopiloto() {
  escutaDesejada = true;
  if (!recognition) inicializarCopilotoVoz();

  atualizarIndicadorUIVoz(true);
  if (!reconhecimentoRodando && !falandoAgora) {
    try {
      recognition.start();
    } catch (e) {}
  }

  const comandoAtual = obterCodigoAtivacaoMotorista();
  notificar(`🎙️ Copiloto ativo! Chame por "${comandoAtual}"`, 'sucesso', 2800);
}

export function desativarEscutaCopiloto() {
  escutaDesejada = false;
  janelaConversaAtiva = false;

  if (timeoutReinicio) {
    clearTimeout(timeoutReinicio);
    timeoutReinicio = null;
  }
  if (timerJanelaConversa) {
    clearTimeout(timerJanelaConversa);
    timerJanelaConversa = null;
  }

  if (recognition && reconhecimentoRodando) {
    try { recognition.stop(); } catch (e) {}
  }
  reconhecimentoRodando = false;
  atualizarIndicadorUIVoz(false);
  liberarWakeLock();
}

// ============================================================================
// RAIO-X COMPLETO DO ESTADO E DA TELA DO MOTORISTA PARA O GEMINI
// ============================================================================
function capturarContextoCompletoApp() {
  const saldoTxt = document.getElementById('saldoCarteiraValor')?.textContent?.trim() || 
                   `R$ ${Number(estado.saldoCarteira || 0).toFixed(2).replace('.', ',')}`;
  const ganhosHojeTxt = document.getElementById('lblGanhosHojeValor')?.textContent?.trim() || 'R$ 0,00';
  const corridasHojeTxt = document.getElementById('lblCorridasHojeQtd')?.textContent?.trim() || '0 viagens';
  const metaDiariaTxt = document.getElementById('lblMetaDiariaTxt')?.textContent?.trim() || `R$ ${estado.metaDiaria || 200}`;

  const nomeCondutor = document.getElementById('drawerNomeCondutor')?.textContent?.trim() || estado.motoristaNome || 'Carol';
  const modeloVeiculo = document.getElementById('drawerCarroModelo')?.textContent?.trim() || 'Onix';
  const placaVeiculo = document.getElementById('drawerCarroPlaca')?.textContent?.trim() || 'ABC1D23';
  const detalhesVeiculo = document.getElementById('drawerCarroDetalhes')?.textContent?.trim() || '';
  const avaliacao = document.getElementById('drawerAvaliacaoTxt')?.textContent?.trim() || '⭐ 5.0';

  // Chamadas pendentes no radar
  const botoesRadar = document.querySelectorAll('#listaChamadasPendentes .btn-accept-order');
  const chamadasRadar = Array.from(botoesRadar).map((btn, idx) => {
    const d = extrairDadosDoBotao(btn);
    const repasse = d.repasse || (Number(d.preco || 0) * 0.85).toFixed(2).replace('.', ',');
    return {
      ordem: idx + 1,
      id: d.id,
      origem: d.origem,
      destino: d.destino,
      distanciaKm: d.dist,
      duracaoMin: d.dur,
      valorBruto: d.preco,
      ganhoLiquidoMotorista: repasse
    };
  });

  // Dados da rota em pré-visualização (se estiver aberta)
  const rotaEmAnalise = estado.pedidoEmAnalise ? {
    id: estado.pedidoEmAnalise.id,
    origem: estado.pedidoEmAnalise.origem,
    destino: estado.pedidoEmAnalise.destino,
    distanciaKm: estado.pedidoEmAnalise.dist,
    duracaoMin: estado.pedidoEmAnalise.dur,
    valorBruto: estado.pedidoEmAnalise.preco,
    ganhoLiquidoMotorista: (Number(estado.pedidoEmAnalise.preco || 0) * 0.85).toFixed(2).replace('.', ',')
  } : null;

  // Dados da corrida ativa aceita (a caminho ou em viagem)
  const corridaAtiva = estado.pedidoAceitoAtual || estado.pedidoAtivo ? {
    id: (estado.pedidoAceitoAtual || estado.pedidoAtivo).id,
    etapa: estado.etapaCorridaAtual || 'a_caminho', // 'a_caminho' | 'em_viagem'
    origem: (estado.pedidoAceitoAtual || estado.pedidoAtivo).origem,
    destino: (estado.pedidoAceitoAtual || estado.pedidoAtivo).destino,
    distanciaKm: (estado.pedidoAceitoAtual || estado.pedidoAtivo).dist,
    duracaoMin: (estado.pedidoAceitoAtual || estado.pedidoAtivo).dur,
    valorBruto: (estado.pedidoAceitoAtual || estado.pedidoAtivo).preco,
    ganhoLiquidoMotorista: (Number((estado.pedidoAceitoAtual || estado.pedidoAtivo).preco || 0) * 0.85).toFixed(2).replace('.', ',')
  } : null;

  // Estado dos Modais e Gavetas na tela
  const previaRotaAberta = Boolean(estado.pedidoEmAnalise || document.getElementById('btnConfirmarAceiteViagem'));
  const modalPagamentoAberto = document.getElementById('modalEscolhaPagamentoMotorista')?.style.display === 'flex';
  const modalSaqueAberto = document.getElementById('modalSaquePix')?.style.display === 'flex';
  const drawerAberto = Boolean(document.getElementById('driverDrawer')?.classList.contains('active'));
  const heatmapAtivo = Boolean(document.getElementById('btnToggleHeatmap')?.classList.contains('active'));

  return {
    nomeCondutor,
    statusOnline: Boolean(estado.isOnline || estado.statusOnline),
    emPausa: Boolean(estado.emPausa),
    modoCasaAtivo: Boolean(estado.destinoCasaAtivo),
    destinoCasa: estado.destinoCasaNome || null,
    heatmapAtivo,
    saldo: saldoTxt,
    ganhosHoje: ganhosHojeTxt,
    corridasHoje: corridasHojeTxt,
    metaDiaria: metaDiariaTxt,
    veiculo: `${modeloVeiculo} (${detalhesVeiculo}) Placa ${placaVeiculo}`,
    avaliacao,
    qtdChamadasNoRadar: chamadasRadar.length,
    primeiraChamadaRadar: chamadasRadar[0] || null,
    todasChamadasRadar: chamadasRadar,
    rotaEmAnalise,
    corridaAtiva,
    telasAbertas: {
      previaRota: previaRotaAberta,
      modalLiquidacaoPagamento: modalPagamentoAberto,
      modalSaquePix: modalSaqueAberto,
      drawerPerfil: drawerAberto
    }
  };
}

// ============================================================================
// PROCESSAMENTO DE VOZ COM DISCERNIMENTO COGNITIVO
// ============================================================================
async function processarEntradaVoz(fraseBruta) {
  if (processandoRequisicao || falandoAgora) return;

  const fraseNormalizada = normalizarTexto(fraseBruta);
  if (!fraseNormalizada || fraseNormalizada.length < 2) return;

  const gatilhoCadastrado = normalizarTexto(obterCodigoAtivacaoMotorista());
  const partesGatilho = gatilhoCadastrado.split(' ').filter(p => !['ok', 'ei', 'oi', 'fala', 'e', 'ai'].includes(p));
  const palavraChave = partesGatilho[partesGatilho.length - 1] || gatilhoCadastrado;

  const palavrasFaladas = fraseNormalizada.split(' ');
  let chamouGatilho = fraseNormalizada.includes(gatilhoCadastrado);

  if (!chamouGatilho) {
    for (const p of palavrasFaladas) {
      if (saoPalavrasParecidas(p, palavraChave) || saoPalavrasParecidas(p, 'huby') || saoPalavrasParecidas(p, 'zank') || saoPalavrasParecidas(p, 'zanix')) {
        chamouGatilho = true;
        break;
      }
    }
  }

  // Aceita se chamou pelo nome OU se está dentro da janela de conversa contínua
  if (!chamouGatilho && !janelaConversaAtiva) return;

  let intencaoLimpa = fraseNormalizada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b(${palavraChave}|huby|zank|zanix|zenix|zanki)\\b`, 'gi'), '')
    .replace(/^(ok|ei|oi|fala|e ai|entao|por favor)\s+/i, '')
    .trim();

  // Se o motorista só chamou pelo nome (ex: "Ok Zank"), responde pronto e abre a janela de escuta
  if (!intencaoLimpa || ['ola', 'oi', 'opa', 'ta ai', 'escuta'].includes(intencaoLimpa)) {
    renovarJanelaConversa(14);
    const ctx = capturarContextoCompletoApp();
    if (ctx.rotaEmAnalise) {
      falarTexto(`Na escuta! Rota de ${ctx.rotaEmAnalise.distanciaKm} quilômetros pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais na tela. Quer aceitar ou voltar?`);
    } else if (ctx.primeiraChamadaRadar) {
      falarTexto(`Tô na escuta! Tem chamada no radar pagando ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} reais. Quer visualizar ou aceitar?`);
    } else if (ctx.corridaAtiva) {
      falarTexto('Na escuta, parceiro. Pode mandar o comando da viagem.');
    } else {
      falarTexto('Na escuta, piloto. O que manda?');
    }
    return;
  }

  processandoRequisicao = true;
  renovarJanelaConversa(12);

  try {
    // 1. Verifica comandos operacionais instantâneos claros para resposta em 0ms
    const executouLocal = tentarExecucaoInstantaneaContextual(intencaoLimpa);
    if (executouLocal) {
      processandoRequisicao = false;
      return;
    }

    // 2. Qualquer frase livre, pergunta analítica ou comando conversacional vai para a mente Gemini
    const contexto = capturarContextoCompletoApp();
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({
        pergunta: fraseBruta,
        intencaoLimpa,
        contextoCompleto: contexto
      })
    });

    const data = await resp.json().catch(() => null);

    if (data && data.acao && data.acao !== 'NENHUMA') {
      await executarAcaoNoApp(data.acao, contexto);
    }

    if (data && data.resposta) {
      falarTexto(data.resposta);
    } else {
      responderContingenciaInteligente(intencaoLimpa, contexto);
    }
  } catch (err) {
    const contexto = capturarContextoCompletoApp();
    responderContingenciaInteligente(intencaoLimpa, contexto);
  } finally {
    processandoRequisicao = false;
  }
}

// ============================================================================
// EXECUÇÃO INSTANTÂNEA CONTEXTUAL (RESPOSTA IMEDIATA PARA COMANDOS DIRETOS)
// ============================================================================
function tentarExecucaoInstantaneaContextual(fala) {
  const ctx = capturarContextoCompletoApp();

  // Se o modal de escolha de pagamento estiver aberto na tela
  if (ctx.telasAbertas.modalLiquidacaoPagamento) {
    if (fala.includes('dinheiro') || fala.includes('especie')) {
      executarAcaoNoApp('PAGAR_DINHEIRO', ctx);
      falarTexto('Confirmado recebimento em dinheiro. Corrida finalizada!');
      return true;
    }
    if (fala.includes('maquininha') || fala.includes('cartao')) {
      executarAcaoNoApp('PAGAR_MAQUININHA', ctx);
      falarTexto('Confirmado pagamento na maquininha. Corrida encerrada!');
      return true;
    }
    if (fala.includes('pix')) {
      executarAcaoNoApp('PAGAR_PIX', ctx);
      falarTexto('Gerando QR Code Pix na tela para o passageiro.');
      return true;
    }
  }

  // Perguntas diretas sobre distância, quilometragem ou tempo
  if (
    (fala.includes('quantos km') || fala.includes('quantos quilometros') || fala.includes('qual a distancia') || fala.includes('quanto tempo') || fala.includes('longe')) &&
    !fala.includes('aceita')
  ) {
    const alvo = ctx.corridaAtiva || ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (alvo) {
      const distNum = parseFloat(alvo.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Essa corrida tem ${distTxt}, tempo estimado de ${alvo.duracaoMin || 5} minutos e ganho líquido de ${alvo.ganhoLiquidoMotorista} reais.`);
    } else {
      falarTexto('Não há nenhuma rota aberta ou no radar neste momento.');
    }
    return true;
  }

  // Visualizar rota no mapa
  if (
    fala.includes('visualiza') || fala.includes('ver rota') || fala.includes('ver a rota') ||
    fala.includes('mostra a rota') || fala.includes('mostrar rota') || fala.includes('olhar rota') ||
    fala.includes('abrir rota') || fala.includes('analisar rota')
  ) {
    if (ctx.primeiraChamadaRadar) {
      executarAcaoNoApp('VISUALIZAR_ROTA', ctx);
      const c = ctx.primeiraChamadaRadar;
      const distNum = parseFloat(c.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Rota na tela! São ${distTxt} até ${c.destino.split(',')[0]}, pagando ${c.ganhoLiquidoMotorista} reais livres. Quer aceitar ou cancelar?`);
    } else if (ctx.rotaEmAnalise) {
      falarTexto(`A rota já está na tela: ${ctx.rotaEmAnalise.distanciaKm} quilômetros pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais. Diga aceitar ou voltar.`);
    } else {
      falarTexto('Não temos chamadas pendentes no radar agora.');
    }
    return true;
  }

  // Aceitar corrida
  if (
    fala === 'aceitar' || fala === 'aceita' || fala.includes('aceitar corrida') ||
    fala.includes('aceita a corrida') || fala.includes('pode aceitar') ||
    fala.includes('pegar corrida') || fala.includes('pega essa') || fala.includes('vamos fazer essa')
  ) {
    if (ctx.rotaEmAnalise || ctx.primeiraChamadaRadar) {
      executarAcaoNoApp('ACEITAR_CORRIDA', ctx);
      const alvo = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
      falarTexto(`Corrida aceita! Traçando rota até o passageiro em ${alvo.origem.split(',')[0]}.`);
    } else {
      falarTexto('Não há chamada disponível para aceitar agora.');
    }
    return true;
  }

  // Cancelar prévia / voltar / recusar chamada
  if (
    fala === 'voltar' || fala === 'volta' || fala === 'cancelar' || fala === 'cancela' ||
    fala.includes('cancelar rota') || fala.includes('cancela a rota') || fala.includes('fechar rota') ||
    fala.includes('fecha a rota') || fala.includes('dispensar') || fala.includes('recusar') ||
    fala.includes('nao quero')
  ) {
    if (ctx.telasAbertas.previaRota || ctx.rotaEmAnalise) {
      executarAcaoNoApp('CANCELAR_ROTA', ctx);
      falarTexto('Rota fechada. Voltamos para o radar.');
      return true;
    }
    if (ctx.qtdChamadasNoRadar > 0) {
      executarAcaoNoApp('CANCELAR_ROTA', ctx);
      falarTexto('Chamada dispensada do radar.');
      return true;
    }
    if (ctx.telasAbertas.drawerPerfil || ctx.telasAbertas.modalSaquePix || ctx.telasAbertas.modalLiquidacaoPagamento) {
      executarAcaoNoApp('FECHAR_TELAS', ctx);
      falarTexto('Tela fechada.');
      return true;
    }
  }

  // Avisar chegada no embarque
  if (
    fala.includes('cheguei') || fala.includes('estou no local') ||
    fala.includes('to no local') || fala.includes('avisa o passageiro') || fala.includes('encostei')
  ) {
    if (ctx.corridaAtiva && ctx.corridaAtiva.etapa === 'a_caminho') {
      executarAcaoNoApp('AVISAR_CHEGADA', ctx);
      falarTexto('Passageiro notificado que você já está no ponto de embarque.');
      return true;
    }
  }

  // Iniciar viagem com passageiro a bordo
  if (
    fala.includes('iniciar viagem') || fala.includes('inicia a viagem') || fala.includes('iniciar corrida') ||
    fala.includes('inicia a corrida') || fala.includes('passageiro embarcou') || fala.includes('passageiro entrou') ||
    fala === 'iniciar' || fala === 'inicia' || fala === 'partiu'
  ) {
    if (ctx.corridaAtiva) {
      executarAcaoNoApp('INICIAR_VIAGEM', ctx);
      falarTexto(`Viagem iniciada! Seguindo para ${ctx.corridaAtiva.destino.split(',')[0]}. Boa corrida!`);
      return true;
    }
  }

  // Finalizar / Concluir corrida
  if (
    fala.includes('finalizar') || fala.includes('finaliza') ||
    fala.includes('concluir') || fala.includes('conclui') ||
    fala.includes('encerrar corrida') || fala.includes('chegamos no destino')
  ) {
    if (ctx.corridaAtiva) {
      executarAcaoNoApp('FINALIZAR_CORRIDA', ctx);
      falarTexto(`Chegamos ao destino! O valor total é ${ctx.corridaAtiva.valorBruto} reais. Diga se o pagamento foi dinheiro, maquininha ou Pix.`);
      return true;
    }
  }

  return false;
}

// ============================================================================
// EXECUTOR UNIVERSAL DE AÇÕES NA INTERFACE DO MOTORISTA
// ============================================================================
async function executarAcaoNoApp(acao, ctx) {
  switch (acao) {
    case 'VISUALIZAR_ROTA': {
      const btn = document.querySelector('#listaChamadasPendentes .btn-accept-order');
      if (btn) {
        pararAlertaSonoroChamada();
        const dados = extrairDadosDoBotao(btn);
        await preVisualizarRotaPedido(dados);
      }
      break;
    }

    case 'ACEITAR_CORRIDA': {
      pararAlertaSonoroChamada();
      if (estado.pedidoEmAnalise) {
        await aceitarCorrida(estado.pedidoEmAnalise);
      } else {
        const btnConfirmar = document.getElementById('btnConfirmarAceiteViagem');
        if (btnConfirmar) {
          btnConfirmar.click();
        } else {
          const btnRadar = document.querySelector('#listaChamadasPendentes .btn-accept-order');
          if (btnRadar) {
            const dados = extrairDadosDoBotao(btnRadar);
            await aceitarCorrida(dados);
          }
        }
      }
      break;
    }

    case 'CANCELAR_ROTA': {
      const btnCancelarPrevia = document.getElementById('btnCancelarPreviaRota');
      if (btnCancelarPrevia) {
        btnCancelarPrevia.click();
      } else if (estado.pedidoEmAnalise) {
        limparRotasMapa();
        pararMonitoramentoDesvios();
        estado.pedidoEmAnalise = null;
        iniciarRadarChamadas();
      } else {
        const btnDispensar = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
        if (btnDispensar) btnDispensar.click();
      }
      break;
    }

    case 'AVISAR_CHEGADA': {
      const btnCheguei = document.getElementById('btnChegueiLocalEmbarque');
      if (btnCheguei) {
        btnCheguei.click();
      } else if (estado.pedidoAceitoAtual) {
        try {
          await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/status`, {
            method: 'PUT',
            headers: obterHeaders(),
            body: JSON.stringify({ status: 'motorista_no_local' })
          });
          notificar('📍 Passageiro avisado que você chegou ao local!', 'sucesso');
        } catch (e) {}
      }
      break;
    }

    case 'INICIAR_VIAGEM': {
      const btnIniciar = document.getElementById('btnIniciarCorridaAtiva');
      if (btnIniciar) {
        btnIniciar.click();
      } else if (estado.pedidoAceitoAtual) {
        await confirmarEmbarqueEIrAoDestino(estado.pedidoAceitoAtual);
      }
      break;
    }

    case 'FINALIZAR_CORRIDA': {
      const btnConcluir = document.getElementById('btnConcluirCorrida');
      if (btnConcluir) {
        btnConcluir.click();
      } else if (estado.pedidoAceitoAtual || estado.pedidoAtivo) {
        abrirModalOpcoesPagamento(estado.pedidoAceitoAtual || estado.pedidoAtivo);
      }
      break;
    }

    case 'PAGAR_DINHEIRO': {
      const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
      if (pedido) await processarLiquidacao(pedido.id, 'dinheiro');
      break;
    }

    case 'PAGAR_MAQUININHA': {
      const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
      if (pedido) await processarLiquidacao(pedido.id, 'cartao_maquininha');
      break;
    }

    case 'PAGAR_PIX': {
      const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
      if (pedido) await processarLiquidacao(pedido.id, 'pix_mp');
      break;
    }

    case 'ABRIR_SAQUE':
      document.getElementById('btnAbrirModalSaque')?.click();
      break;

    case 'ABRIR_PERFIL':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      break;

    case 'ABRIR_EDICAO_PERFIL':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      setTimeout(() => document.getElementById('btnAbrirModalEdicaoPerfil')?.click(), 200);
      break;

    case 'ABRIR_CHAT':
      document.getElementById('btnAbrirChat')?.click();
      break;

    case 'ABRIR_LOJA':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      setTimeout(() => document.getElementById('btnAbrirMarketplaceDrawer')?.click(), 200);
      break;

    case 'ALTERNAR_CALOR':
      document.getElementById('btnToggleHeatmap')?.click();
      break;

    case 'ALTERNAR_PAUSA':
      document.getElementById('btnModoPausa')?.click();
      break;

    case 'ALTERNAR_MODO_CASA':
      document.getElementById('btnModoDestino')?.click();
      break;

    case 'EXPORTAR_FECHAMENTO':
      exportarResumoDia();
      break;

    case 'FICAR_OFFLINE':
      if (estado.isOnline) await alternarStatusOnline();
      break;

    case 'FICAR_ONLINE':
      if (!estado.isOnline) await alternarStatusOnline();
      break;

    case 'FECHAR_TELAS':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnFecharModalEdicao')?.click();
      document.getElementById('btnFecharModalSaque')?.click();
      document.getElementById('btnFecharMarketplace')?.click();
      document.getElementById('btnFecharChat')?.click();
      fecharModaisPagamento();
      break;
  }
}

function responderContingenciaInteligente(fala, ctx) {
  if (fala.includes('saldo') || fala.includes('carteira')) {
    falarTexto(`Seu saldo disponível na carteira é de ${ctx.saldo}.`);
  } else if (fala.includes('ganho') || fala.includes('hoje') || fala.includes('faturei')) {
    falarTexto(`Hoje você já acumulou ${ctx.ganhosHoje} em ${ctx.corridasHoje}.`);
  } else if (fala.includes('chamada') || fala.includes('radar') || fala.includes('corrida')) {
    if (ctx.primeiraChamadaRadar) {
      falarTexto(`Temos chamada no radar para ${ctx.primeiraChamadaRadar.destino.split(',')[0]}, pagando ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} reais.`);
    } else {
      falarTexto('O radar está limpo no momento. Assim que pintar corrida eu te aviso.');
    }
  } else {
    falarTexto('Tô na escuta acompanhando sua rota.');
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
    badge.style.transition = 'all 0.25s ease';
    badge.style.cursor = 'pointer';
    badge.title = 'Toque para ativar ou pausar o Copiloto';
    badge.addEventListener('click', () => {
      if (escutaDesejada) {
        desativarEscutaCopiloto();
      } else {
        ativarEscutaCopiloto();
      }
    });
    document.body.appendChild(badge);
  }

  const gatilho = obterCodigoAtivacaoMotorista();
  if (ativo) {
    badge.style.background = 'rgba(16, 185, 129, 0.22)';
    badge.style.border = '1px solid #10B981';
    badge.style.color = '#10B981';
    badge.innerHTML = `🎙️ "${gatilho}" Ativo`;
  } else {
    badge.style.background = 'rgba(15, 23, 42, 0.88)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    badge.style.color = '#94A3B8';
    badge.innerHTML = `🎙️ "${gatilho}" Pausado`;
  }
}