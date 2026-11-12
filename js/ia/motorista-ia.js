// js/ia/motorista-ia.js - Copiloto HUBy com Controle 100% pelo Botão do Menu e Todos os Comandos da Tela
import { API_URL } from '../config.js';
import { estado, obterHeaders } from '../motorista/motorista-estado.js';
import { 
  extrairDadosDoBotao, 
  pararAlertaSonoroChamada, 
  alternarStatusOnline, 
  iniciarRadarChamadas 
} from '../motorista/motorista-radar.js';
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

const sintetizador = typeof window !== 'undefined' ? window.speechSynthesis : null;

let recognition = null;
// A IA só fica ativa se o motorista ligou explicitamente o switch no menu do copiloto
let escutaDesejada = localStorage.getItem('huby_copiloto_menu_ativo') === 'true';
let reconhecimentoRodando = false;
let falandoAgora = false;
let processandoRequisicao = false;
let timeoutReinicio = null;
let wakeLockSentinel = null;

let janelaConversaAtiva = false;
let timerJanelaConversa = null;
const historicoConversa = [];

// ============================================================================
// PREFERÊNCIAS DE VOZ DO COPILOTO
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
    .replace(/\s+c$/i, '')
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
  return salvo && salvo.trim() ? salvo.trim() : 'Jarvis';
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

function renovarJanelaConversa(segundos = 35) {
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
      if (escutaDesejada) {
        renovarJanelaConversa(35);
        agendarReinicioMicrofone(550);
      }
    };

    utter.onend = finalizarFala;
    utter.onerror = finalizarFala;

    sintetizador.speak(utter);
  } catch (err) {
    falandoAgora = false;
    if (escutaDesejada) agendarReinicioMicrofone(550);
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
// CONTROLE DO MICROFONE (SÓ LIGA PELO BOTÃO DO MENU DO COPILOTO)
// ============================================================================
function agendarReinicioMicrofone(delayMs = 600) {
  if (timeoutReinicio) {
    clearTimeout(timeoutReinicio);
    timeoutReinicio = null;
  }

  if (!escutaDesejada || falandoAgora) return;

  timeoutReinicio = setTimeout(() => {
    if (!escutaDesejada || falandoAgora || reconhecimentoRodando) return;
    if (!recognition) inicializarCopilotoVoz();
    try {
      recognition.start();
    } catch (e) {}
  }, delayMs);
}

export function inicializarCopilotoVoz() {
  document.getElementById('badgeCopilotoVozStatus')?.remove();
  document.getElementById('btnConfigCopiloto')?.remove();
  document.getElementById('painelCopilotoConfig')?.remove();

  configurarControlesCopilotoDrawer();

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
    if (escutaDesejada && !falandoAgora) {
      agendarReinicioMicrofone(650);
    } else if (!escutaDesejada) {
      atualizarIndicadorUIVoz(false);
      liberarWakeLock();
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      escutaDesejada = false;
      reconhecimentoRodando = false;
      localStorage.setItem('huby_copiloto_menu_ativo', 'false');
      atualizarIndicadorUIVoz(false);
      notificar('Permissão de microfone bloqueada no navegador.', 'alerta');
    }
  };

  recognition.onresult = (ev) => {
    if (falandoAgora || !escutaDesejada) return;
    const ultimo = ev.results[ev.results.length - 1];
    if (!ultimo || !ultimo[0]) return;
    const transcricao = ultimo[0].transcript;
    if (transcricao && transcricao.trim()) {
      processarEntradaVoz(transcricao.trim());
    }
  };

  atualizarIndicadorUIVoz(escutaDesejada);
  return true;
}

/**
 * IMPORTANTE: Se `origemMenu` não for `true`, significa que foi chamado automaticamente
 * pelo `motorista-radar.js` quando o motorista clicou em "Ficar Online".
 * Nesse caso, NÃO ligamos a IA a menos que o motorista já tenha deixado o botão do Copiloto ligado no menu!
 */
export function ativarEscutaCopiloto(origemMenu = false) {
  if (!origemMenu && localStorage.getItem('huby_copiloto_menu_ativo') !== 'true') {
    atualizarIndicadorUIVoz(false);
    return;
  }

  escutaDesejada = true;
  localStorage.setItem('huby_copiloto_menu_ativo', 'true');
  if (!recognition) inicializarCopilotoVoz();

  atualizarIndicadorUIVoz(true);
  if (!reconhecimentoRodando && !falandoAgora) {
    try {
      recognition.start();
    } catch (e) {}
  }

  if (origemMenu) {
    const comandoAtual = obterCodigoAtivacaoMotorista();
    notificar(`🎙️ Copiloto ligado! Chame por "${comandoAtual}"`, 'sucesso', 2500);
  }
}

export function desativarEscutaCopiloto(origemMenu = false) {
  // Se foi chamado pelo botão "Ficar Offline" da corrida, mas o motorista quer o copiloto ligado no menu, não desliga!
  if (!origemMenu && localStorage.getItem('huby_copiloto_menu_ativo') === 'true') {
    return;
  }

  escutaDesejada = false;
  localStorage.setItem('huby_copiloto_menu_ativo', 'false');
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

  if (origemMenu) {
    notificar('Copiloto de voz desligado.', 'info', 2000);
  }
}

export function restaurarPreferenciaCopiloto() {
  configurarControlesCopilotoDrawer();
  if (localStorage.getItem('huby_copiloto_menu_ativo') === 'true') {
    ativarEscutaCopiloto(false);
  } else {
    atualizarIndicadorUIVoz(false);
  }
}

// ============================================================================
// CONTROLES DO COPILOTO EMBUTIDOS NO MENU DO MOTORISTA (DRAWER)
// ============================================================================
function configurarControlesCopilotoDrawer() {
  const chk = document.getElementById('chkCopilotoAtivo');
  const selVoz = document.getElementById('selVozCopiloto');
  const selTom = document.getElementById('selTomCopiloto');
  const rng = document.getElementById('rngVelocidadeCopiloto');

  if (chk && !chk.dataset.configurado) {
    chk.dataset.configurado = 'true';
    chk.checked = escutaDesejada;
    chk.addEventListener('change', () => {
      if (chk.checked) {
        ativarEscutaCopiloto(true);
      } else {
        desativarEscutaCopiloto(true);
      }
    });
  }

  if (selTom && !selTom.dataset.configurado) {
    selTom.dataset.configurado = 'true';
    const tomSalvo = obterTomVoz();
    selTom.value = tomSalvo <= 0.9 ? '0.75' : (tomSalvo >= 1.15 ? '1.3' : '1');
    selTom.addEventListener('change', () => {
      localStorage.setItem('huby_ia_tom', selTom.value);
    });
  }

  if (rng && !rng.dataset.configurado) {
    rng.dataset.configurado = 'true';
    rng.value = String(obterVelocidadeVoz());
    rng.addEventListener('input', () => {
      localStorage.setItem('huby_ia_velocidade', rng.value);
    });
  }

  if (selVoz && !selVoz.dataset.configurado) {
    selVoz.dataset.configurado = 'true';
    const preencherVozes = () => {
      const lista = vozesDisponiveis();
      const atual = obterVozEscolhida();
      selVoz.innerHTML = lista.length
        ? lista.map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join('')
        : '<option value="">Voz padrão do aparelho</option>';
      if (atual) selVoz.value = atual.voiceURI;
    };
    preencherVozes();
    if (sintetizador) {
      sintetizador.onvoiceschanged = preencherVozes;
    }
    selVoz.addEventListener('change', () => {
      localStorage.setItem('huby_ia_voz', selVoz.value);
    });
  }
}

function atualizarIndicadorUIVoz(ativo) {
  document.getElementById('badgeCopilotoVozStatus')?.remove();
  document.getElementById('btnConfigCopiloto')?.remove();

  const gatilho = obterCodigoAtivacaoMotorista();
  const chkAtivo = document.getElementById('chkCopilotoAtivo');
  const lblStatus = document.getElementById('lblStatusCopilotoDrawer');

  if (chkAtivo) {
    chkAtivo.checked = Boolean(ativo);
  }

  if (lblStatus) {
    if (ativo) {
      lblStatus.style.color = '#10B981';
      lblStatus.textContent = `🟢 Ativo • Escutando "${gatilho}"`;
    } else {
      lblStatus.style.color = '#94A3B8';
      lblStatus.textContent = '⚪ Desativado • Ligue na chave ao lado para usar';
    }
  }
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
  const modalEdicaoAberto = document.getElementById('modalEdicaoPerfil')?.style.display === 'flex';
  const modalLojaAberto = document.getElementById('modalMarketplace')?.style.display === 'flex';
  const drawerAberto = Boolean(document.getElementById('driverDrawer')?.classList.contains('active'));
  const heatmapAtivo = Boolean(document.getElementById('btnToggleHeatmap')?.classList.contains('active'));
  const pausaAtiva = Boolean(estado.emPausa || document.getElementById('btnModoPausa')?.classList.contains('active'));
  const modoCasaAtivo = Boolean(estado.destinoCasaAtivo || document.getElementById('btnModoDestino')?.classList.contains('active'));

  const btnOnlineTexto = document.getElementById('btnToggleStatusOnline')?.textContent || '';
  const estaOnlineReal = Boolean(estado.isOnline || estado.statusOnline || (btnOnlineTexto.includes('Online') && !btnOnlineTexto.includes('Ficar Online')));

  return {
    codigoVoz: obterCodigoAtivacaoMotorista(),
    nomeCondutor,
    statusOnline: estaOnlineReal,
    emPausa: pausaAtiva,
    modoCasaAtivo,
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
      modalEdicaoPerfil: modalEdicaoAberto,
      modalLoja: modalLojaAberto,
      drawerPerfil: drawerAberto
    }
  };
}

// ============================================================================
// INTERPRETADOR DE VOZ COM COMPREENSÃO TOTAL DE TODOS OS BOTÕES DA TELA
// ============================================================================
async function processarEntradaVoz(fraseBruta) {
  if (processandoRequisicao || falandoAgora || !escutaDesejada) return;

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
        saoPalavrasParecidas(p, 'jarvis') ||
        saoPalavrasParecidas(p, 'javis') ||
        saoPalavrasParecidas(p, 'chaves') ||
        saoPalavrasParecidas(p, 'huby') ||
        saoPalavrasParecidas(p, 'zank') ||
        saoPalavrasParecidas(p, 'zanix') ||
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
    .replace(new RegExp(`\\b(${palavraChave}|jarvis|javis|chaves|huby|zank|zanix|zenix|zanki|xanix|xanax|xanx)\\b`, 'gi'), '')
    .replace(/^(ok|okay|ei|oi|fala|e ai|entao|por favor)\s+/i, '')
    .trim();

  const ctx = capturarContextoCompletoApp();

  if (!intencaoLimpa || ['ola', 'oi', 'opa', 'ta ai', 'escuta'].includes(intencaoLimpa)) {
    renovarJanelaConversa(35);
    if (ctx.rotaEmAnalise) {
      falarTexto(`Na escuta, ${ctx.nomeCondutor}! Rota de ${ctx.rotaEmAnalise.distanciaKm} quilômetros pagando R$ ${ctx.rotaEmAnalise.ganhoLiquidoMotorista}. Aceita ou cancela?`);
    } else if (ctx.primeiraChamadaRadar) {
      falarTexto(`Oi, ${ctx.nomeCondutor}! Tem pedido no radar pagando R$ ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista}. Quer visualizar ou tirar da tela?`);
    } else {
      falarTexto(`Diga lá, ${ctx.nomeCondutor}! Estou ouvindo.`);
    }
    return;
  }

  processandoRequisicao = true;
  renovarJanelaConversa(35);

  try {
    // 1. Executa imediatamente qualquer comando da interface do motorista (0ms de atraso)
    const resolveuInstantaneo = await resolverIntencaoSemanticaLocal(intencaoLimpa, ctx);
    if (resolveuInstantaneo) {
      processandoRequisicao = false;
      return;
    }

    // 2. Conversas abertas e perguntas livres vão para o Gemini no servidor
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
      falarTexto(`Pronto, ${ctx.nomeCondutor}.`, intencaoLimpa);
    }
  } catch (err) {
    falarTexto(`Combinado, ${ctx.nomeCondutor}.`, intencaoLimpa);
  } finally {
    processandoRequisicao = false;
  }
}

// ============================================================================
// CÉREBRO SEMÂNTICO LOCAL (COBRE 100% DOS BOTÕES E FUNÇÕES DA TELA)
// ============================================================================
async function resolverIntencaoSemanticaLocal(fala, ctx) {
  const nome = ctx.nomeCondutor;

  // 1. CONFIRMAÇÕES CURTAS
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

  // 2. FICAR OFFLINE / DESCONECTAR CARRO
  if (
    fala.includes('ficar offline') || fala.includes('fica offline') ||
    fala.includes('sair do online') || fala.includes('desconectar') ||
    fala.includes('parar de receber') || fala === 'offline'
  ) {
    await executarAcaoNoApp('FICAR_OFFLINE', ctx);
    falarTexto(`Pronto, ${nome}! Coloquei você offline para corridas.`, fala);
    return true;
  }

  // 3. FICAR ONLINE / CONECTAR CARRO
  if (
    fala.includes('ficar online') || fala.includes('fica online') ||
    fala.includes('entrar online') || fala.includes('conectar') ||
    fala.includes('receber corrida') || fala === 'online'
  ) {
    await executarAcaoNoApp('FICAR_ONLINE', ctx);
    falarTexto(`Você está online para receber chamadas, ${nome}! Boas corridas.`, fala);
    return true;
  }

  // 4. MODO PAUSA (Ativar ou Desativar)
  if (fala.includes('pausa') || fala.includes('descansar') || fala.includes('cafe') || fala.includes('abastecer')) {
    const querDesativar = fala.includes('desativa') || fala.includes('sair da pausa') || fala.includes('tirar pausa') || fala.includes('encerrar pausa');
    const querAtivar = fala.includes('ativa') || fala.includes('ligar') || fala.includes('entrar');

    if ((querDesativar && ctx.emPausa) || (querAtivar && !ctx.emPausa) || (!querDesativar && !querAtivar)) {
      await executarAcaoNoApp('ALTERNAR_PAUSA', ctx);
    }

    const ficouEmPausa = Boolean(document.getElementById('btnModoPausa')?.classList.contains('active'));
    if (ficouEmPausa) {
      falarTexto(`Modo pausa de 15 minutos ativado, ${nome}.`, fala);
    } else {
      falarTexto(`Modo pausa desativado! Radar de corridas restabelecido.`, fala);
    }
    return true;
  }

  // 5. HUBY LOJA / CLUBE DE VANTAGENS (Cobre "huby loja", "ubi loja", "abrir loja", "clube", "descontos")
  if (
    fala.includes('loja') || fala.includes('ubi loja') || fala.includes('huby loja') ||
    fala.includes('clube') || fala.includes('vantagens') || fala.includes('desconto') ||
    fala.includes('marketplace') || fala.includes('oficina') || fala.includes('guincho')
  ) {
    await executarAcaoNoApp('ABRIR_LOJA', ctx);
    falarTexto(`Abri a HUBy Loja e Clube de Vantagens na sua tela, ${nome}!`, fala);
    return true;
  }

  // 6. IR PARA CASA / MODO DESTINO ("ir para casa", "modo casa", "rota para casa")
  if (
    fala.includes('ir para casa') || fala.includes('ir pra casa') ||
    fala.includes('modo casa') || fala.includes('modo destino') ||
    fala.includes('rota para casa') || fala.includes('voltar para casa')
  ) {
    await executarAcaoNoApp('ALTERNAR_MODO_CASA', ctx);
    if (ctx.modoCasaAtivo) {
      falarTexto(`Modo ir para casa desativado, ${nome}. Recebendo corridas para qualquer direção.`, fala);
    } else {
      falarTexto(`Acionei o modo ir para casa na tela, ${nome}. Informe ou confirme o seu bairro de destino.`, fala);
    }
    return true;
  }

  // 7. EDITAR DADOS E FOTO ("editar dados", "editar foto", "mudar foto", "editar perfil")
  if (
    fala.includes('editar dados') || fala.includes('editar foto') ||
    fala.includes('dados e foto') || fala.includes('mudar foto') ||
    fala.includes('editar perfil') || fala.includes('alterar dados')
  ) {
    await executarAcaoNoApp('ABRIR_EDICAO_PERFIL', ctx);
    falarTexto(`Abri a tela de editar dados e foto do seu perfil, ${nome}.`, fala);
    return true;
  }

  // 8. ABRIR PERFIL / MENU LATERAL ("abrir perfil", "abrir menu", "meu perfil")
  if (
    fala.includes('abrir perfil') || fala.includes('abre o perfil') ||
    fala.includes('abrir menu') || fala.includes('abre o menu') ||
    fala.includes('meu perfil') || fala.includes('ver perfil')
  ) {
    await executarAcaoNoApp('ABRIR_PERFIL', ctx);
    falarTexto(`Menu do perfil aberto na tela, ${nome}.`, fala);
    return true;
  }

  // 9. FECHAR PERFIL / FECHAR MENU / FECHAR JANELA
  if (
    fala.includes('fechar perfil') || fala.includes('fecha o perfil') ||
    fala.includes('fechar menu') || fala.includes('fecha o menu') ||
    fala.includes('fechar tela') || fala.includes('fechar janela') ||
    fala.includes('fechar loja') || fala.includes('fechar saque')
  ) {
    await executarAcaoNoApp('FECHAR_TELAS', ctx);
    falarTexto(`Pronto, fechei e voltei para o mapa principal.`, fala);
    return true;
  }

  // 10. DEFINIR META DIÁRIA ("definir meta", "mudar meta", "meta para 300")
  if (fala.includes('definir meta') || fala.includes('mudar meta') || fala.includes('alterar meta') || fala.includes('nova meta')) {
    const matchValor = fala.match(/(\d+)/);
    if (matchValor) {
      const novoValor = Number(matchValor[1]);
      if (novoValor >= 10) {
        estado.metaDiaria = novoValor;
        localStorage.setItem('huby_meta_diaria', String(novoValor));
        const lblMeta = document.getElementById('lblMetaDiariaTxt');
        if (lblMeta) lblMeta.textContent = `Meta: R$ ${novoValor.toFixed(2).replace('.', ',')} (0%)`;
        falarTexto(`Meta diária atualizada para ${novoValor} reais, ${nome}!`, fala);
        return true;
      }
    }
    await executarAcaoNoApp('DEFINIR_META', ctx);
    falarTexto(`Abri a definição de meta diária na tela, ${nome}.`, fala);
    return true;
  }

  // 11. SOLICITAR SAQUE PIX / ABRIR SAQUE ("solicitar saque", "saque pix", "sacar")
  if (
    fala.includes('solicitar saque') || fala.includes('saque pix') ||
    fala.includes('abrir saque') || fala.includes('quero sacar') ||
    fala.includes('fazer saque') || fala.includes('retirar dinheiro') ||
    fala === 'sacar' || fala === 'saque'
  ) {
    await executarAcaoNoApp('ABRIR_SAQUE', ctx);
    falarTexto(`Abri a tela de solicitação de saque Pix, ${nome}. Seu saldo atual é de ${ctx.saldo}.`, fala);
    return true;
  }

  // 12. DESCARREGAR FECHAMENTO DO DIA
  if (fala.includes('fechamento') || fala.includes('relatorio do dia') || fala.includes('exportar resumo') || fala.includes('descarregar fechamento')) {
    await executarAcaoNoApp('EXPORTAR_FECHAMENTO', ctx);
    falarTexto(`Baixando o relatório de fechamento do dia no seu aparelho, ${nome}.`, fala);
    return true;
  }

  // 13. REPORTAR PROBLEMA OU OBJETO ESQUECIDO
  if (fala.includes('reportar problema') || fala.includes('objeto esquecido') || fala.includes('abrir incidente')) {
    document.getElementById('btnAbrirModalIncidente')?.click();
    falarTexto(`Abri a tela para reportar problema ou objeto esquecido, ${nome}.`, fala);
    return true;
  }

  // 14. ATIVAR / DESATIVAR MAPA DE CALOR
  if (fala.includes('calor') || fala.includes('demanda') || fala.includes('zona quente')) {
    const estavaAtivo = ctx.heatmapAtivo;
    await executarAcaoNoApp('ALTERNAR_CALOR', ctx);
    if (!estavaAtivo || fala.includes('ativar') || fala.includes('ligar')) {
      falarTexto(`Mapa de calor ativado na tela, ${nome}!`, fala);
    } else {
      falarTexto(`Mapa de calor desativado.`, fala);
    }
    return true;
  }

  // 15. TIRAR PEDIDO DA TELA / DISPENSAR / CANCELAR ROTA
  if (
    fala.includes('tirar pedido') || fala.includes('tirar o pedido') || fala.includes('tirar esse pedido') ||
    fala.includes('tira esse pedido') || fala.includes('tira o pedido') || fala.includes('tirar da tela') ||
    fala.includes('tira da tela') || fala.includes('limpar tela') || fala.includes('dispensar') ||
    fala.includes('dispensa') || fala.includes('recusar') || fala.includes('recusa') ||
    fala.includes('cancelar') || fala.includes('cancela') || fala.includes('voltar') ||
    fala.includes('volta') || fala.includes('nao quero')
  ) {
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

    if (ctx.qtdChamadasNoRadar > 0) {
      await executarAcaoNoApp('DISPENSAR_PEDIDO_RADAR', ctx);
      falarTexto('Pedido retirado da tela! Seguimos aguardando uma chamada melhor.', fala);
      return true;
    }

    if (
      ctx.telasAbertas.drawerPerfil ||
      ctx.telasAbertas.modalSaquePix ||
      ctx.telasAbertas.modalEdicaoPerfil ||
      ctx.telasAbertas.modalLoja ||
      ctx.telasAbertas.modalLiquidacaoPagamento
    ) {
      await executarAcaoNoApp('FECHAR_TELAS', ctx);
      falarTexto('Fechei a janela para você.', fala);
      return true;
    }

    falarTexto('Sua tela já está limpa, sem nenhum pedido no radar agora.', fala);
    return true;
  }

  // 16. CHECAR PEDIDO / VISUALIZAR ROTA
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
      falarTexto(`Abri a rota no mapa! É de ${c.origem.split(',')[0]} para ${c.destino.split(',')[0]}, dando ${distTxt} e pagando R$ ${c.ganhoLiquidoMotorista}. Quer aceitar ou tirar da tela?`, fala);
      return true;
    }
    if (ctx.rotaEmAnalise) {
      const r = ctx.rotaEmAnalise;
      const distNum = parseFloat(r.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      falarTexto(`O pedido já está aberto no mapa: são ${distTxt} até ${r.destino.split(',')[0]}, pagando R$ ${r.ganhoLiquidoMotorista}. Quer aceitar ou cancelar?`, fala);
      return true;
    }
    falarTexto(`Olhei aqui no radar e não tem nenhum pedido na tela neste momento, ${nome}.`, fala);
    return true;
  }

  // 17. HORÁRIO ATUAL E MELHOR HORÁRIO
  if (
    (fala.includes('qual o horario') || fala.includes('qual e o horario') || fala.includes('que horas') || fala.includes('hora agora') || fala.includes('horario agora')) &&
    !fala.includes('melhor')
  ) {
    const agora = new Date();
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    falarTexto(`Agora são exatamente ${horaFormatada}, ${nome}.`, fala);
    return true;
  }

  if (fala.includes('melhor horario') || fala.includes('melhores horarios') || fala.includes('horario bom') || fala.includes('horario para corrida')) {
    falarTexto(`Os horários que mais tocam corrida são das 6 e meia às 9 da manhã, no almoço entre 11 e meia e 2 da tarde, e no pico das 17 às 20 horas, ${nome}.`, fala);
    return true;
  }

  // 18. ACEITAR CORRIDA
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

  // 19. PAGAMENTO, CHEGADA, INÍCIO E FIM DE CORRIDA
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
      falarTexto(`Corrida concluída! O total deu R$ ${ctx.corridaAtiva.valorBruto}. Foi dinheiro, maquininha ou Pix?`, fala);
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
      const btnCancelarPrevia = document.getElementById('btnCancelarPreviaRota');
      if (btnCancelarPrevia) {
        btnCancelarPrevia.click();
      }
      setTimeout(() => {
        const btnDispensar = document.querySelector('#listaChamadasPendentes .btn-dispensar-pedido');
        if (btnDispensar) {
          btnDispensar.click();
        } else {
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
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnAbrirModalSaque')?.click();
      break;

    case 'ABRIR_PERFIL':
      document.getElementById('btnAbrirDrawerPerfil')?.click();
      break;

    case 'ABRIR_EDICAO_PERFIL':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnAbrirModalEdicaoPerfil')?.click();
      break;

    case 'ABRIR_CHAT':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnAbrirChat')?.click();
      break;

    case 'ABRIR_LOJA':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnAbrirMarketplaceDrawer')?.click();
      break;

    case 'DEFINIR_META':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnEditarMetaDiaria')?.click();
      break;

    case 'ALTERNAR_CALOR':
      document.getElementById('btnToggleHeatmap')?.click();
      break;

    case 'ALTERNAR_PAUSA':
      document.getElementById('btnModoPausa')?.click();
      break;

    case 'ALTERNAR_MODO_CASA':
      document.getElementById('btnFecharDrawerPerfil')?.click();
      document.getElementById('btnModoDestino')?.click();
      break;

    case 'EXPORTAR_FECHAMENTO':
      exportarResumoDia();
      break;

    case 'FICAR_OFFLINE': {
      const btnOnline = document.getElementById('btnToggleStatusOnline');
      const estaOn = estado.isOnline || estado.statusOnline || (btnOnline && !btnOnline.textContent.includes('Ficar Online'));
      if (estaOn) {
        if (btnOnline) btnOnline.click();
        else await alternarStatusOnline();
      }
      break;
    }

    case 'FICAR_ONLINE': {
      const btnOnline = document.getElementById('btnToggleStatusOnline');
      const estaOn = estado.isOnline || estado.statusOnline || (btnOnline && !btnOnline.textContent.includes('Ficar Online'));
      if (!estaOn) {
        if (btnOnline) btnOnline.click();
        else await alternarStatusOnline();
      }
      break;
    }

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