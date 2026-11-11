// js/ia/motorista-ia.js - Copiloto Conversacional Livre com Controle Total da Área do Motorista
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

// Janela de conversa ativa (25 segundos após qualquer interação para conversar sem repetir o nome)
let janelaConversaAtiva = false;
let timerJanelaConversa = null;

// Memória das últimas interações para manter contexto de conversa real
const historicoConversa = [];

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

  falarTexto(`Perfeito! Agora você pode me chamar dizendo ${fraseLimpa}.`);
  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

function renovarJanelaConversa(segundos = 25) {
  janelaConversaAtiva = true;
  if (timerJanelaConversa) clearTimeout(timerJanelaConversa);
  timerJanelaConversa = setTimeout(() => {
    janelaConversaAtiva = false;
  }, segundos * 1000);
}

function registrarMemoriaConversa(falaMotorista, respostaIA) {
  if (!falaMotorista || !respostaIA) return;
  historicoConversa.push({ motorista: falaMotorista, ia: respostaIA });
  if (historicoConversa.length > 6) {
    historicoConversa.shift();
  }
}

// ============================================================================
// SINTETIZADOR DE VOZ FLUIDO E NATURAL
// ============================================================================
export function falarTexto(texto, falaOriginalMotorista = null) {
  if (!texto) return;
  if (falaOriginalMotorista) {
    registrarMemoriaConversa(falaOriginalMotorista, texto);
  }

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

    if (recognition && reconhecimentoRodando) {
      try { recognition.stop(); } catch (e) {}
    }

    sintetizador.cancel();
    const utter = new SpeechSynthesisUtterance(String(texto));
    utter.lang = 'pt-BR';
    utter.rate = 1.12;
    utter.pitch = 1.0;

    const finalizarFala = () => {
      falandoAgora = false;
      renovarJanelaConversa(25);
      agendarReinicioMicrofone(600);
    };

    utter.onend = finalizarFala;
    utter.onerror = finalizarFala;

    sintetizador.speak(utter);
  } catch (err) {
    falandoAgora = false;
    agendarReinicioMicrofone(600);
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
// CONTROLE ESTÁVEL DO MICROFONE (ANTI-LOOP)
// ============================================================================
function agendarReinicioMicrofone(delayMs = 650) {
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

    if (escutaDesejada && online) {
      if (!falandoAgora) {
        agendarReinicioMicrofone(700);
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
    }
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
  notificar(`🎙️ Copiloto ativo! Converse dizendo "${comandoAtual}"`, 'sucesso', 2800);
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
// LEITURA COMPLETA DO CONTEXTO DA TELA EM TEMPO REAL
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

  const rotaEmAnalise = estado.pedidoEmAnalise ? {
    id: estado.pedidoEmAnalise.id,
    origem: estado.pedidoEmAnalise.origem,
    destino: estado.pedidoEmAnalise.destino,
    distanciaKm: estado.pedidoEmAnalise.dist,
    duracaoMin: estado.pedidoEmAnalise.dur,
    valorBruto: estado.pedidoEmAnalise.preco,
    ganhoLiquidoMotorista: (Number(estado.pedidoEmAnalise.preco || 0) * 0.85).toFixed(2).replace('.', ',')
  } : null;

  const corridaAtiva = estado.pedidoAceitoAtual || estado.pedidoAtivo ? {
    id: (estado.pedidoAceitoAtual || estado.pedidoAtivo).id,
    etapa: estado.etapaCorridaAtual || 'a_caminho',
    origem: (estado.pedidoAceitoAtual || estado.pedidoAtivo).origem,
    destino: (estado.pedidoAceitoAtual || estado.pedidoAtivo).destino,
    distanciaKm: (estado.pedidoAceitoAtual || estado.pedidoAtivo).dist,
    duracaoMin: (estado.pedidoAceitoAtual || estado.pedidoAtivo).dur,
    valorBruto: (estado.pedidoAceitoAtual || estado.pedidoAtivo).preco,
    ganhoLiquidoMotorista: (Number((estado.pedidoAceitoAtual || estado.pedidoAtivo).preco || 0) * 0.85).toFixed(2).replace('.', ',')
  } : null;

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
// PROCESSAMENTO DE VOZ FLEXÍVEL E CONVERSACIONAL
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
      if (
        saoPalavrasParecidas(p, palavraChave) ||
        saoPalavrasParecidas(p, 'huby') ||
        saoPalavrasParecidas(p, 'zank') ||
        saoPalavrasParecidas(p, 'zanix') ||
        saoPalavrasParecidas(p, 'xanax') ||
        saoPalavrasParecidas(p, 'zenix')
      ) {
        chamouGatilho = true;
        break;
      }
    }
  }

  // Aceita se chamou pelo nome OU se a janela de conversa de 25s está aberta
  if (!chamouGatilho && !janelaConversaAtiva) return;

  let intencaoLimpa = fraseNormalizada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b(${palavraChave}|huby|zank|zanix|zenix|zanki|xanax|xanx)\\b`, 'gi'), '')
    .replace(/^(ok|okay|ei|oi|fala|e ai|entao|por favor)\s+/i, '')
    .trim();

  // Se o motorista só chamou pelo nome ("Ok Zanix"), responde de forma amigável e contextual
  if (!intencaoLimpa || ['ola', 'oi', 'opa', 'ta ai', 'escuta', 'fala comigo'].includes(intencaoLimpa)) {
    renovarJanelaConversa(25);
    const ctx = capturarContextoCompletoApp();
    if (ctx.rotaEmAnalise) {
      falarTexto(`Oi! A rota de ${ctx.rotaEmAnalise.distanciaKm} quilômetros pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais está aberta. Quer aceitar, cancelar ou saber algum detalhe?`);
    } else if (ctx.primeiraChamadaRadar) {
      falarTexto(`Oi, parceiro! Tem uma corrida no radar pagando ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} reais. Quer visualizar a rota ou conversar sobre outra coisa?`);
    } else {
      falarTexto(`Fala comigo, parceiro! Estou na escuta. Pode mandar qualquer comando ou perguntar o que quiser!`);
    }
    return;
  }

  processandoRequisicao = true;
  renovarJanelaConversa(25);

  try {
    // 1. Verifica intenções de ação direta na tela (flexível para frases como "quero cancelar", "pode visualizar", etc.)
    const executouLocal = await tentarAcaoIntuitivaLocal(intencaoLimpa);
    if (executouLocal) {
      processandoRequisicao = false;
      return;
    }

    // 2. Conversa livre, perguntas sobre corridas, melhores horários, dicas ou comandos complexos -> Gemini
    const contexto = capturarContextoCompletoApp();
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({
        pergunta: fraseBruta,
        intencaoLimpa,
        contextoCompleto: contexto,
        historicoConversa
      })
    });

    const data = await resp.json().catch(() => null);

    if (data && data.acao && data.acao !== 'NENHUMA') {
      await executarAcaoNoApp(data.acao, contexto);
    }

    if (data && data.resposta) {
      falarTexto(data.resposta, intencaoLimpa);
    } else {
      responderConversaLocalInteligente(intencaoLimpa, contexto);
    }
  } catch (err) {
    const contexto = capturarContextoCompletoApp();
    responderConversaLocalInteligente(intencaoLimpa, contexto);
  } finally {
    processandoRequisicao = false;
  }
}

// ============================================================================
// INTENÇÕES LOCAIS FLEXÍVEIS (ENTENDE FRASES COMPLETAS NATURALMENTE)
// ============================================================================
async function tentarAcaoIntuitivaLocal(fala) {
  const ctx = capturarContextoCompletoApp();

  // 1. Modal de pagamento aberto
  if (ctx.telasAbertas.modalLiquidacaoPagamento) {
    if (fala.includes('dinheiro') || fala.includes('especie')) {
      await executarAcaoNoApp('PAGAR_DINHEIRO', ctx);
      falarTexto('Confirmado recebimento em dinheiro! Corrida encerrada com sucesso.', fala);
      return true;
    }
    if (fala.includes('maquininha') || fala.includes('cartao')) {
      await executarAcaoNoApp('PAGAR_MAQUININHA', ctx);
      falarTexto('Pagamento na maquininha registrado! Corrida finalizada.', fala);
      return true;
    }
    if (fala.includes('pix')) {
      await executarAcaoNoApp('PAGAR_PIX', ctx);
      falarTexto('Gerando o QR Code Pix na tela para o passageiro pagar.', fala);
      return true;
    }
  }

  // 2. CANCELAR / VOLTAR / FECHAR / NÃO QUERO (Entende "quero cancelar", "pode cancelar", "cancela essa", "voltar", etc.)
  if (
    fala.includes('cancelar') || fala.includes('cancela') ||
    fala.includes('voltar') || fala.includes('volta') ||
    fala.includes('dispensar') || fala.includes('dispensa') ||
    fala.includes('recusar') || fala.includes('recusa') ||
    fala.includes('nao quero') || fala.includes('fechar rota') || fala.includes('fecha a rota')
  ) {
    if (ctx.telasAbertas.previaRota || ctx.rotaEmAnalise) {
      await executarAcaoNoApp('CANCELAR_ROTA', ctx);
      falarTexto('Pronto, cancelei a visualização da rota e voltamos para o radar.', fala);
      return true;
    }
    if (ctx.qtdChamadasNoRadar > 0) {
      await executarAcaoNoApp('CANCELAR_ROTA', ctx);
      falarTexto('Chamada dispensada! Continuamos aguardando uma corrida melhor.', fala);
      return true;
    }
    if (ctx.telasAbertas.drawerPerfil || ctx.telasAbertas.modalSaquePix || ctx.telasAbertas.modalLiquidacaoPagamento) {
      await executarAcaoNoApp('FECHAR_TELAS', ctx);
      falarTexto('Pronto, fechei a janela.', fala);
      return true;
    }
    falarTexto('Não tem nenhuma rota aberta para cancelar agora, estamos no radar principal.', fala);
    return true;
  }

  // 3. VISUALIZAR ROTA (Entende "quero visualizar", "visualizar rota", "mostra a rota", "ver no mapa", etc.)
  if (
    fala.includes('visualizar') || fala.includes('visualiza') ||
    fala.includes('ver rota') || fala.includes('ver a rota') ||
    fala.includes('mostrar rota') || fala.includes('mostra a rota') ||
    fala.includes('olhar rota') || fala.includes('abrir rota')
  ) {
    if (ctx.primeiraChamadaRadar) {
      await executarAcaoNoApp('VISUALIZAR_ROTA', ctx);
      const c = ctx.primeiraChamadaRadar;
      const distNum = parseFloat(c.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Rota aberta no mapa! São ${distTxt} pagando ${c.ganhoLiquidoMotorista} reais livres. Você quer aceitar ou cancelar?`, fala);
      return true;
    }
    if (ctx.rotaEmAnalise) {
      const distNum = parseFloat(ctx.rotaEmAnalise.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Essa rota já está aberta na sua tela! São ${distTxt} pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais. Quer que eu aceite ou cancele?`, fala);
      return true;
    }
    falarTexto('Não temos nenhuma chamada pendente no radar neste momento para visualizar.', fala);
    return true;
  }

  // 4. ACEITAR CORRIDA (Entende "quero aceitar", "pode aceitar", "aceita essa", "pegar corrida", etc.)
  if (
    fala.includes('aceitar') || fala.includes('aceita') ||
    fala.includes('confirmar corrida') || fala.includes('confirma essa') ||
    fala.includes('pegar corrida') || fala.includes('pega essa') ||
    fala.includes('quero fazer essa') || fala.includes('vamos fazer essa')
  ) {
    if (ctx.rotaEmAnalise || ctx.primeiraChamadaRadar) {
      const alvo = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
      await executarAcaoNoApp('ACEITAR_CORRIDA', ctx);
      falarTexto(`Show! Corrida aceita. Já tracei a rota no mapa para buscar o passageiro.`, fala);
      return true;
    }
    falarTexto('Não tem nenhuma chamada disponível no momento para aceitar.', fala);
    return true;
  }

  // 5. CHEGADA NO EMBARQUE
  if (
    fala.includes('cheguei') || fala.includes('estou no local') ||
    fala.includes('to no local') || fala.includes('avisa o passageiro') || fala.includes('encostei')
  ) {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('AVISAR_CHEGADA', ctx);
      falarTexto('Avisei o passageiro que você já está no ponto de embarque! Assim que ele entrar, me diga para iniciar a viagem.', fala);
      return true;
    }
  }

  // 6. INICIAR VIAGEM
  if (
    fala.includes('iniciar') || fala.includes('inicia') ||
    fala.includes('passageiro embarcou') || fala.includes('passageiro entrou') ||
    fala.includes('comecar viagem') || fala.includes('comeca a viagem') || fala === 'partiu'
  ) {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('INICIAR_VIAGEM', ctx);
      falarTexto(`Viagem iniciada! Seguindo rota para o destino final. Boa corrida!`, fala);
      return true;
    }
  }

  // 7. FINALIZAR / CONCLUIR CORRIDA
  if (
    fala.includes('finalizar') || fala.includes('finaliza') ||
    fala.includes('concluir') || fala.includes('conclui') ||
    fala.includes('encerrar corrida') || fala.includes('chegamos no destino')
  ) {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('FINALIZAR_CORRIDA', ctx);
      falarTexto(`Chegamos ao destino! Abri a tela de pagamento no valor de ${ctx.corridaAtiva.valorBruto} reais. Foi em dinheiro, maquininha ou Pix?`, fala);
      return true;
    }
  }

  // 8. TEM ALGUMA ROTA / CHAMADA NO RADAR?
  if (
    fala.includes('tem alguma rota') || fala.includes('tem rota') ||
    fala.includes('tem alguma corrida') || fala.includes('tem corrida') ||
    fala.includes('tem chamada')
  ) {
    if (ctx.primeiraChamadaRadar) {
      const c = ctx.primeiraChamadaRadar;
      const distNum = parseFloat(c.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Sim! Temos uma chamada no radar de ${distTxt} pagando ${c.ganhoLiquidoMotorista} reais livres. Quer visualizar a rota ou aceitar direto?`, fala);
    } else if (ctx.rotaEmAnalise) {
      falarTexto(`Você já está com uma rota em análise na tela pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais. Quer aceitar ou cancelar?`, fala);
    } else {
      falarTexto('Ainda não tocou nenhuma chamada no radar, mas estou monitorando aqui. Assim que aparecer eu te aviso!', fala);
    }
    return true;
  }

  return false;
}

// ============================================================================
// CONVERSA INTELIGENTE LOCAL (RESPONDE QUALQUER PERGUNTA MESMO SEM INTERNET/API)
// ============================================================================
function responderConversaLocalInteligente(fala, ctx) {
  // Quantas corridas / ganhos de hoje
  if (fala.includes('quantas corridas') || fala.includes('quantas viagens') || fala.includes('fiz hoje')) {
    falarTexto(`Hoje você completou ${ctx.corridasHoje}, somando ${ctx.ganhosHoje} de lucro líquido. Sua meta do dia é ${ctx.metaDiaria}. Quer alguma dica para bater a meta mais rápido?`, fala);
    return;
  }

  // Quanto ganhou / saldo / dinheiro
  if (fala.includes('quanto ganhei') || fala.includes('meus ganhos') || fala.includes('faturei') || fala.includes('saldo') || fala.includes('carteira')) {
    falarTexto(`Hoje você já faturou ${ctx.ganhosHoje} em ${ctx.corridasHoje}, e o seu saldo disponível na carteira para saque é de ${ctx.saldo}. Quer que eu abra a tela de saque Pix?`, fala);
    return;
  }

  // Melhores horários para rodar / movimento / pico
  if (fala.includes('melhor horario') || fala.includes('melhores horarios') || fala.includes('horario bom') || fala.includes('horario para corrida') || fala.includes('pico') || fala.includes('movimento')) {
    falarTexto(`Os horários de ouro para fazer corrida são de manhã cedo, das 6 e meia às 9 horas, no horário de almoço entre 11 e meia e 2 da tarde, e no fim da tarde das 17 às 20 horas. Se quiser ver onde estão chamando mais agora, é só me pedir para ligar o mapa de calor!`, fala);
    return;
  }

  // Distância / Quilômetros / Tempo da rota
  if (fala.includes('quantos km') || fala.includes('quantos quilometros') || fala.includes('distancia') || fala.includes('quanto tempo') || fala.includes('longe')) {
    const alvo = ctx.corridaAtiva || ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (alvo) {
      const distNum = parseFloat(alvo.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Esse trajeto tem ${distTxt}, levando cerca de ${alvo.duracaoMin || 5} minutos, com ganho líquido de ${alvo.ganhoLiquidoMotorista} reais para você.`, fala);
    } else {
      falarTexto('Nenhuma corrida aberta no momento para eu medir a distância, parceiro.', fala);
    }
    return;
  }

  // Compensa / Vale a pena?
  if (fala.includes('compensa') || fala.includes('vale a pena') || fala.includes('acha dessa')) {
    const alvo = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (alvo) {
      const km = parseFloat(alvo.distanciaKm || 1);
      const ganho = parseFloat(String(alvo.ganhoLiquidoMotorista || '0').replace(',', '.'));
      const relacao = km > 0 ? (ganho / km).toFixed(2).replace('.', ',') : ganho;
      falarTexto(`Analisando aqui: são ${alvo.ganhoLiquidoMotorista} reais livres para rodar ${alvo.distanciaKm} quilômetros, pagando ${relacao} reais por quilômetro. É uma corrida rápida que gira bem o caixa! Quer aceitar?`, fala);
    } else {
      falarTexto('Assim que aparecer uma chamada no radar eu calculo o valor por quilômetro e te digo na hora se vale a pena!', fala);
    }
    return;
  }

  // Mapa de calor
  if (fala.includes('calor') || fala.includes('demanda') || fala.includes('onde tem passageiro')) {
    executarAcaoNoApp('ALTERNAR_CALOR', ctx);
    falarTexto('Acionei o mapa de calor na tela para você ver os pontos com mais chamadas na região!', fala);
    return;
  }

  // Pausa
  if (fala.includes('pausa') || fala.includes('descansar') || fala.includes('almocar') || fala.includes('abastecer')) {
    executarAcaoNoApp('ALTERNAR_PAUSA', ctx);
    falarTexto('Modo pausa acionado! Você tem 15 minutos tranquilos sem tocar corridas.', fala);
    return;
  }

  // Saque
  if (fala.includes('saque') || fala.includes('sacar') || fala.includes('pix')) {
    executarAcaoNoApp('ABRIR_SAQUE', ctx);
    falarTexto(`Abri a tela de saque Pix. Seu saldo disponível é de ${ctx.saldo}.`, fala);
    return;
  }

  // Perfil / Carro / Placa
  if (fala.includes('meu carro') || fala.includes('minha placa') || fala.includes('veiculo') || fala.includes('minha nota')) {
    falarTexto(`Você está rodando com o ${ctx.veiculo} e sua nota atual é ${ctx.avaliacao}. Tudo em dia!`, fala);
    return;
  }

  falarTexto(`Estou aqui com você, ${ctx.nomeCondutor}! Hoje você tem ${ctx.corridasHoje} e ${ctx.saldo} na carteira. Pode me pedir para ver rotas, analisar corridas, checar melhores horários ou controlar o painel!`, fala);
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