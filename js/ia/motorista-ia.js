// js/ia/motorista-ia.js - Copiloto Inteligente com Raciocínio Lógico, Zero Repetição e Controle Total
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

// Janela de conversa contínua (30s): permite conversar fluidamente sem repetir "Zanix" a cada frase
let janelaConversaAtiva = false;
let timerJanelaConversa = null;

const historicoConversa = [];

// ============================================================================
// PREFERÊNCIAS DO COPILOTO (guardadas no aparelho do motorista)
// ============================================================================
function vozesDisponiveis() {
  const todas = sintetizador ? sintetizador.getVoices() : [];
  const pt = todas.filter((v) => /^pt([-_]|$)/i.test(v.lang));
  return pt.length ? pt : todas;
}

function obterVozEscolhida() {
  const uri = localStorage.getItem('huby_ia_voz');
  const lista = vozesDisponiveis();
  return lista.find((v) => v.voiceURI === uri)
    || lista.find((v) => /pt[-_]BR/i.test(v.lang))
    || lista[0]
    || null;
}

function obterTomVoz() {
  const t = Number(localStorage.getItem('huby_ia_tom'));
  return t >= 0.5 && t <= 2 ? t : 1.0;
}

function obterVelocidadeVoz() {
  const v = Number(localStorage.getItem('huby_ia_velocidade'));
  return v >= 0.7 && v <= 1.6 ? v : 1.05;
}
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

function limparNomeCondutorParaVoz(nomeBruto = '') {
  return String(nomeBruto || 'parceiro')
    .replace(/_cs$/i, '')
    .replace(/[_.-]+/g, ' ')
    .split(' ')[0]
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

  falarTexto(`Combinado! Agora atendo pelo nome ${fraseLimpa}.`);
  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

function renovarJanelaConversa(segundos = 30) {
  janelaConversaAtiva = true;
  if (timerJanelaConversa) clearTimeout(timerJanelaConversa);
  timerJanelaConversa = setTimeout(() => {
    janelaConversaAtiva = false;
  }, segundos * 1000);
}

function registrarMemoriaConversa(falaMotorista, respostaIA) {
  if (!falaMotorista || !respostaIA) return;
  historicoConversa.push({ motorista: falaMotorista, ia: respostaIA });
  if (historicoConversa.length > 8) {
    historicoConversa.shift();
  }
}

// ============================================================================
// SINTETIZADOR DE VOZ FLUIDO
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
    const voz = obterVozEscolhida();
    if (voz) utter.voice = voz;
    utter.lang = voz?.lang || 'pt-BR';
    utter.rate = obterVelocidadeVoz();
    utter.pitch = obterTomVoz();

    const finalizarFala = () => {
      falandoAgora = false;
      renovarJanelaConversa(30);
      agendarReinicioMicrofone(550);
    };

    utter.onend = finalizarFala;
    utter.onerror = finalizarFala;

    sintetizador.speak(utter);
  } catch (err) {
    falandoAgora = false;
    agendarReinicioMicrofone(550);
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
// MICROFONE ESTÁVEL SEM LOOP
// ============================================================================
function agendarReinicioMicrofone(delayMs = 600) {
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
        agendarReinicioMicrofone(650);
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
  localStorage.setItem('huby_ia_ativa', 'true');
  if (!recognition) inicializarCopilotoVoz();

  atualizarIndicadorUIVoz(true);
  if (!reconhecimentoRodando && !falandoAgora) {
    try {
      recognition.start();
    } catch (e) {}
  }

  const comandoAtual = obterCodigoAtivacaoMotorista();
  notificar(`🎙️ Copiloto ativo! Fale com "${comandoAtual}"`, 'sucesso', 2500);
}

export function desativarEscutaCopiloto() {
  escutaDesejada = false;
  localStorage.setItem('huby_ia_ativa', 'false');
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
// CAPTURA DE CONTEXTO DA TELA EM TEMPO REAL
// ============================================================================
function capturarContextoCompletoApp() {
  const saldoTxt = document.getElementById('saldoCarteiraValor')?.textContent?.trim() || 
                   `R$ ${Number(estado.saldoCarteira || 0).toFixed(2).replace('.', ',')}`;
  const ganhosHojeTxt = document.getElementById('lblGanhosHojeValor')?.textContent?.trim() || 'R$ 0,00';
  const corridasHojeTxt = document.getElementById('lblCorridasHojeQtd')?.textContent?.trim() || '0 viagens';
  const metaDiariaTxt = document.getElementById('lblMetaDiariaTxt')?.textContent?.trim() || `R$ ${estado.metaDiaria || 200}`;

  const nomeBruto = document.getElementById('drawerNomeCondutor')?.textContent?.trim() || estado.motoristaNome || 'Tarcyo';
  const nomeCondutor = limparNomeCondutorParaVoz(nomeBruto);
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
    codigoVoz: obterCodigoAtivacaoMotorista(),
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
// INTERPRETADOR DE VOZ COM COMPREENSÃO NATURAL E CONVERSA ABERTA
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
        saoPalavrasParecidas(p, 'xanix') ||
        saoPalavrasParecidas(p, 'zenix')
      ) {
        chamouGatilho = true;
        break;
      }
    }
  }

  if (!chamouGatilho && !janelaConversaAtiva) return;

  let intencaoLimpa = fraseNormalizada
    .replace(gatilhoCadastrado, '')
    .replace(new RegExp(`\\b(${palavraChave}|huby|zank|zanix|zenix|zanki|xanix|xanax|xanx)\\b`, 'gi'), '')
    .replace(/^(ok|okay|ei|oi|fala|e ai|entao|por favor)\s+/i, '')
    .trim();

  const ctx = capturarContextoCompletoApp();

  // Caso tenha chamado apenas o nome ("Zanix" / "Ok Zanix")
  if (!intencaoLimpa || ['ola', 'oi', 'opa', 'ta ai', 'escuta'].includes(intencaoLimpa)) {
    renovarJanelaConversa(30);
    if (ctx.rotaEmAnalise) {
      falarTexto(`Na escuta, ${ctx.nomeCondutor}! Rota de ${ctx.rotaEmAnalise.distanciaKm} quilômetros pagando ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} reais na tela. Aceita ou cancela?`);
    } else if (ctx.primeiraChamadaRadar) {
      falarTexto(`Oi, ${ctx.nomeCondutor}! Tem pedido no radar pagando ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} reais. Quer visualizar ou tirar da tela?`);
    } else {
      falarTexto(`Diga lá, ${ctx.nomeCondutor}! Estou ouvindo.`);
    }
    return;
  }

  processandoRequisicao = true;
  renovarJanelaConversa(30);

  try {
    // 1. Verifica comandos operacionais e perguntas diretas com resposta instantânea (Zero latência)
    const resolveuInstantaneo = await resolverIntencaoSemanticaLocal(intencaoLimpa, ctx);
    if (resolveuInstantaneo) {
      processandoRequisicao = false;
      return;
    }

    // 2. Conversa aberta / Raciocínio livre com o Gemini no Backend
    const resp = await fetch(`${API_URL}/api/ia/motorista-suporte`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({
        pergunta: fraseBruta,
        intencaoLimpa,
        contextoCompleto: ctx,
        historicoConversa
      })
    });

    const data = await resp.json().catch(() => null);

    if (data && data.acao && data.acao !== 'NENHUMA') {
      await executarAcaoNoApp(data.acao, ctx);
    }

    if (data && data.resposta) {
      falarTexto(data.resposta, intencaoLimpa);
    } else {
      falarTexto(`Entendido, ${ctx.nomeCondutor}. Seguimos monitorando!`, intencaoLimpa);
    }
  } catch (err) {
    falarTexto(`Combinado, ${ctx.nomeCondutor}. Tô atento aqui no painel.`, intencaoLimpa);
  } finally {
    processandoRequisicao = false;
  }
}

// ============================================================================
// CÉREBRO SEMÂNTICO LOCAL (ENTENDE TODAS AS VARIAÇÕES DE FALA NA HORA)
// ============================================================================
async function resolverIntencaoSemanticaLocal(fala, ctx) {
  const nome = ctx.nomeCondutor;

  // 1. CONFIRMAÇÕES CURTAS ("certo", "beleza", "ok", "valeu", "tá bom") -> Responde curto sem repetir nada!
  if (/^(certo|ok|okay|beleza|blz|valeu|obrigado|entendi|show|perfeito|ta bom|tudo bem|positivo|fechou)$/.test(fala)) {
    const respostas = [
      `Combinado, ${nome}!`,
      `Show! Qualquer coisa é só falar.`,
      `Beleza, seguimos na escuta!`,
      `Tranquilo, parceiro!`
    ];
    falarTexto(respostas[Math.floor(Math.random() * respostas.length)], fala);
    return true;
  }

  // 2. ATIVAR / DESATIVAR MAPA DE CALOR ("ativar mapa calor", "ligar calor", "mapa de calor")
  if (fala.includes('calor') || fala.includes('demanda') || fala.includes('zona quente')) {
    const estavaAtivo = ctx.heatmapAtivo;
    await executarAcaoNoApp('ALTERNAR_CALOR', ctx);
    if (!estavaAtivo || fala.includes('ativar') || fala.includes('ligar')) {
      falarTexto(`Mapa de calor ativado na tela, ${nome}! Agora você consegue ver as regiões com mais pedidos.`, fala);
    } else {
      falarTexto(`Mapa de calor desativado.`, fala);
    }
    return true;
  }

  // 3. TIRAR PEDIDO DA TELA / DISPENSAR / CANCELAR PEDIDO ("tirar pedido da tela", "tira esse pedido", "cancela esse pedido")
  if (
    fala.includes('tirar pedido') || fala.includes('tirar o pedido') || fala.includes('tirar esse pedido') ||
    fala.includes('tira esse pedido') || fala.includes('tira o pedido') || fala.includes('tirar da tela') ||
    fala.includes('tira da tela') || fala.includes('limpar tela') || fala.includes('dispensar') ||
    fala.includes('dispensa') || fala.includes('recusar') || fala.includes('recusa') ||
    fala.includes('cancelar') || fala.includes('cancela') || fala.includes('voltar') ||
    fala.includes('volta') || fala.includes('nao quero')
  ) {
    // Se a rota estiver aberta em análise no mapa, fecha a prévia e se ele pediu pra "tirar pedido da tela", também dispensa do radar!
    if (ctx.telasAbertas.previaRota || ctx.rotaEmAnalise) {
      await executarAcaoNoApp('CANCELAR_ROTA', ctx);
      if (fala.includes('tirar') || fala.includes('tira') || fala.includes('dispens') || fala.includes('recus') || fala.includes('pedido')) {
        setTimeout(() => {
          executarAcaoNoApp('DISPENSAR_PEDIDO_RADAR', ctx);
        }, 250);
        falarTexto('Pronto! Fechei a rota e já tirei esse pedido da sua tela.', fala);
      } else {
        falarTexto('Pronto, cancelei a visualização da rota e voltamos para o radar.', fala);
      }
      return true;
    }

    // Se estiver no radar com pedido na tela
    if (ctx.qtdChamadasNoRadar > 0) {
      await executarAcaoNoApp('DISPENSAR_PEDIDO_RADAR', ctx);
      falarTexto('Pedido retirado da tela! Seguimos aguardando uma chamada melhor.', fala);
      return true;
    }

    if (ctx.telasAbertas.drawerPerfil || ctx.telasAbertas.modalSaquePix || ctx.telasAbertas.modalLiquidacaoPagamento) {
      await executarAcaoNoApp('FECHAR_TELAS', ctx);
      falarTexto('Fechei a janela para você.', fala);
      return true;
    }

    falarTexto('Sua tela já está limpa, sem nenhum pedido no radar agora.', fala);
    return true;
  }

  // 4. CHECAR PEDIDO QUE VEIO AGORA / VER ROTA / VISUALIZAR ("checa esse pedido que veio agora", "visualizar rota", "ver rota")
  if (
    fala.includes('visualizar') || fala.includes('visualiza') ||
    fala.includes('ver rota') || fala.includes('ver a rota') ||
    fala.includes('mostrar rota') || fala.includes('mostra a rota') ||
    fala.includes('checa') || fala.includes('checar') ||
    fala.includes('pedido que veio') || fala.includes('chamada que veio') ||
    fala.includes('ver esse pedido') || fala.includes('ve esse pedido') ||
    fala.includes('olhar rota') || fala.includes('abrir rota')
  ) {
    if (ctx.primeiraChamadaRadar) {
      await executarAcaoNoApp('VISUALIZAR_ROTA', ctx);
      const c = ctx.primeiraChamadaRadar;
      const distNum = parseFloat(c.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`Abri a rota no mapa! É de ${c.origem.split(',')[0]} para ${c.destino.split(',')[0]}, dando ${distTxt} e pagando ${c.ganhoLiquidoMotorista} reais livres. Quer aceitar ou tirar da tela?`, fala);
      return true;
    }
    if (ctx.rotaEmAnalise) {
      const r = ctx.rotaEmAnalise;
      const distNum = parseFloat(r.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`O pedido já está aberto no mapa: são ${distTxt} até ${r.destino.split(',')[0]}, pagando ${r.ganhoLiquidoMotorista} reais livres. Quer aceitar ou cancelar?`, fala);
      return true;
    }
    falarTexto(`Olhei aqui no radar e não tem nenhum pedido na tela neste momento, ${nome}.`, fala);
    return true;
  }

  // 5. QUAL O HORÁRIO AGORA / QUE HORAS SÃO ("qual o horário agora?", "que horas são?")
  if (
    (fala.includes('qual o horario') || fala.includes('qual e o horario') || fala.includes('que horas') || fala.includes('hora agora') || fala.includes('horario agora')) &&
    !fala.includes('melhor')
  ) {
    const agora = new Date();
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const h = agora.getHours();
    let comentario = 'Bom momento para ficar atento às chamadas próximas.';
    if (h >= 6 && h < 9) comentario = 'Estamos na faixa de pico da manhã!';
    else if (h >= 11 && h < 14) comentario = 'Horário de almoço, costuma ter bastante saída.';
    else if (h >= 15 && h < 17) comentario = 'Movimento de tarde tranquilo, logo mais às 17 horas começa o pico forte.';
    else if (h >= 17 && h <= 20) comentario = 'Estamos no pico do fim de tarde, hora de faturar!';

    falarTexto(`Agora são exatamente ${horaFormatada}, ${nome}. ${comentario}`, fala);
    return true;
  }

  // 6. MELHOR HORÁRIO PARA CORRIDA
  if (fala.includes('melhor horario') || fala.includes('melhores horarios') || fala.includes('horario bom') || fala.includes('horario para corrida')) {
    falarTexto(`Os horários que mais tocam corrida são das 6 e meia às 9 da manhã, no almoço entre 11 e meia e 2 da tarde, e no pico das 17 às 20 horas, ${nome}.`, fala);
    return true;
  }

  // 7. ACEITAR CORRIDA
  if (
    fala.includes('aceitar') || fala.includes('aceita') ||
    fala.includes('confirmar corrida') || fala.includes('pegar corrida') ||
    fala.includes('pega essa') || fala.includes('vou fazer essa')
  ) {
    if (ctx.rotaEmAnalise || ctx.primeiraChamadaRadar) {
      await executarAcaoNoApp('ACEITAR_CORRIDA', ctx);
      falarTexto(`Corrida aceita, ${nome}! Já tracei o caminho até o passageiro.`, fala);
      return true;
    }
    falarTexto('Não há nenhum pedido na tela para aceitar agora.', fala);
    return true;
  }

  // 8. MODAL DE PAGAMENTO ABERTO
  if (ctx.telasAbertas.modalLiquidacaoPagamento) {
    if (fala.includes('dinheiro') || fala.includes('especie')) {
      await executarAcaoNoApp('PAGAR_DINHEIRO', ctx);
      falarTexto('Recebimento em dinheiro confirmado! Corrida finalizada.', fala);
      return true;
    }
    if (fala.includes('maquininha') || fala.includes('cartao')) {
      await executarAcaoNoApp('PAGAR_MAQUININHA', ctx);
      falarTexto('Pagamento na maquininha confirmado! Corrida encerrada.', fala);
      return true;
    }
    if (fala.includes('pix')) {
      await executarAcaoNoApp('PAGAR_PIX', ctx);
      falarTexto('Mostrando o QR Code Pix na tela para o passageiro.', fala);
      return true;
    }
  }

  // 9. CHEGADA E VIAGEM ATIVA
  if (fala.includes('cheguei') || fala.includes('no local') || fala.includes('encostei')) {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('AVISAR_CHEGADA', ctx);
      falarTexto('Avisei o passageiro que você chegou no ponto de embarque!', fala);
      return true;
    }
  }

  if (fala.includes('iniciar') || fala.includes('inicia') || fala.includes('embarcou') || fala === 'partiu') {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('INICIAR_VIAGEM', ctx);
      falarTexto('Viagem iniciada! Seguindo rota para o destino.', fala);
      return true;
    }
  }

  if (fala.includes('finalizar') || fala.includes('finaliza') || fala.includes('concluir') || fala.includes('encerrar')) {
    if (ctx.corridaAtiva) {
      await executarAcaoNoApp('FINALIZAR_CORRIDA', ctx);
      falarTexto(`Corrida concluída! O total deu ${ctx.corridaAtiva.valorBruto} reais. Foi dinheiro, maquininha ou Pix?`, fala);
      return true;
    }
  }

  return false;
}

// ============================================================================
// EXECUTOR DE AÇÕES NA INTERFACE DO MOTORISTA
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

    case 'DISPENSAR_PEDIDO_RADAR': {
      pararAlertaSonoroChamada();
      // Se estiver na prévia, primeiro volta pro radar e depois clica em dispensar
      const btnCancelarPrevia = document.getElementById('btnCancelarPreviaRota');
      if (btnCancelarPrevia) {
        btnCancelarPrevia.click();
      }
      setTimeout(() => {
        const btnDispensar = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
        if (btnDispensar) {
          btnDispensar.click();
        } else {
          // Caso o card use atributo data-id no botão de aceitar, adiciona aos ignorados e remove o card da tela
          const btnAceitar = document.querySelector('#listaChamadasPendentes .btn-accept-order');
          if (btnAceitar) {
            const idPed = btnAceitar.getAttribute('data-id');
            if (idPed && estado.pedidosIgnorados) {
              estado.pedidosIgnorados.add(String(idPed));
            }
            const card = btnAceitar.closest('.call-card') || btnAceitar.parentElement?.parentElement;
            if (card) card.remove();
          }
        }
      }, 150);
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
  criarBotaoConfigCopiloto();
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
  const chkAtivo = document.getElementById('chkCopilotoAtivo');
  if (chkAtivo) chkAtivo.checked = Boolean(ativo);
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


// ============================================================================
// PAINEL DE CONFIGURAÇÃO DO COPILOTO (ativar, voz, tom e velocidade)
// ============================================================================
function criarBotaoConfigCopiloto() {
  if (document.getElementById('btnConfigCopiloto')) return;

  const gear = document.createElement('button');
  gear.id = 'btnConfigCopiloto';
  gear.type = 'button';
  gear.textContent = '⚙️';
  gear.title = 'Configurar Copiloto';
  gear.style.cssText = 'position:fixed;bottom:66px;right:18px;z-index:9999;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,0.15);background:rgba(15,23,42,0.88);color:#fff;font-size:17px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.5);';
  gear.addEventListener('click', abrirPainelCopiloto);
  document.body.appendChild(gear);
}

function abrirPainelCopiloto() {
  const existente = document.getElementById('painelCopilotoConfig');
  if (existente) { existente.remove(); return; }

  const estiloRotulo = 'display:block;font-size:11px;font-weight:800;color:#94A3B8;margin:10px 0 4px;text-transform:uppercase;';
  const estiloCampo = 'width:100%;padding:9px;border-radius:8px;background:#090D16;color:#fff;border:1px solid rgba(255,255,255,0.15);font-size:13px;';

  const painel = document.createElement('div');
  painel.id = 'painelCopilotoConfig';
  painel.style.cssText = 'position:fixed;bottom:114px;right:18px;z-index:10000;width:290px;max-width:calc(100vw - 36px);background:rgba(15,23,42,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:14px;color:#fff;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,0.6);';
  painel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong style="font-size:14px;">🎙️ Copiloto IA</strong>
      <button type="button" id="btnFecharPainelCopiloto" style="background:none;border:none;color:#94A3B8;font-size:18px;cursor:pointer;">✕</button>
    </div>

    <label style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-weight:700;">
      <span>Copiloto ativado</span>
      <input type="checkbox" id="chkCopilotoAtivo" style="width:22px;height:22px;">
    </label>

    <label style="${estiloRotulo}">Voz</label>
    <select id="selVozCopiloto" style="${estiloCampo}"></select>

    <label style="${estiloRotulo}">Tom da voz</label>
    <select id="selTomCopiloto" style="${estiloCampo}">
      <option value="0.75">Grave (mais masculina)</option>
      <option value="1">Normal</option>
      <option value="1.3">Aguda (mais feminina)</option>
    </select>

    <label style="${estiloRotulo}">Velocidade</label>
    <input type="range" id="rngVelocidadeCopiloto" min="0.8" max="1.4" step="0.05" style="width:100%;">

    <button type="button" id="btnTestarVozCopiloto" style="width:100%;margin-top:14px;padding:11px;border:none;border-radius:10px;background:#10B981;color:#032017;font-weight:900;font-size:13px;cursor:pointer;">▶ Testar voz</button>
  `;
  document.body.appendChild(painel);

  const chk = painel.querySelector('#chkCopilotoAtivo');
  const selVoz = painel.querySelector('#selVozCopiloto');
  const selTom = painel.querySelector('#selTomCopiloto');
  const rng = painel.querySelector('#rngVelocidadeCopiloto');

  chk.checked = escutaDesejada;
  rng.value = String(obterVelocidadeVoz());

  // Tom: escolhe a opção mais próxima do valor salvo
  const tomSalvo = obterTomVoz();
  selTom.value = tomSalvo <= 0.9 ? '0.75' : (tomSalvo >= 1.15 ? '1.3' : '1');

  // As vozes do aparelho às vezes demoram a carregar
  const preencherVozes = () => {
    const lista = vozesDisponiveis();
    const atual = obterVozEscolhida();
    selVoz.innerHTML = lista.length
      ? lista.map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join('')
      : '<option value="">Voz padrão do aparelho</option>';
    if (atual) selVoz.value = atual.voiceURI;
  };
  preencherVozes();
  if (sintetizador) sintetizador.onvoiceschanged = preencherVozes;

  chk.addEventListener('change', () => {
    if (chk.checked) ativarEscutaCopiloto();
    else desativarEscutaCopiloto();
  });

  selVoz.addEventListener('change', () => localStorage.setItem('huby_ia_voz', selVoz.value));
  selTom.addEventListener('change', () => localStorage.setItem('huby_ia_tom', selTom.value));
  rng.addEventListener('input', () => localStorage.setItem('huby_ia_velocidade', rng.value));

  painel.querySelector('#btnTestarVozCopiloto').addEventListener('click', () => {
    falarTexto('Olá parceiro! Essa é a minha voz. Como posso te ajudar hoje?');
  });

  painel.querySelector('#btnFecharPainelCopiloto').addEventListener('click', () => painel.remove());
}

// Chamar uma vez quando a tela do motorista abrir
export function restaurarPreferenciaCopiloto() {
  atualizarIndicadorUIVoz(false);
  if (localStorage.getItem('huby_ia_ativa') === 'true') {
    ativarEscutaCopiloto();
  }
}