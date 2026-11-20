/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Sincronizada em Tempo Real + Histórico Detalhado + Fila Offline + Suporte IA
 */

import { API_URL, sincronizarTarifasServidor, aplicarObjetoTarifas, TAXA_PLATAFORMA_ATUAL } from './config.js';
import { estado } from './motorista/motorista-estado.js';
import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas } from './motorista/motorista-radar.js';
import {
  carregarPerfil,
  configurarSalvarPreferenciasPagto,
  configurarEdicaoPerfil
} from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';
import { configurarMarketplace } from './motorista/motorista-loja.js';
import { inicializarPushNotifications } from './motorista/motorista-push.js';
import { configurarModosInteligentes } from './motorista/motorista-modos.js';
import { inicializarZonasRiscoMapa } from './motorista/motorista-zonas-risco.js';
import { processarFilaOfflineMotorista } from './motorista/motorista-corrida.js';
import {
  inicializarCopilotoVoz,
  definirCodigoAtivacaoMotorista,
  obterCodigoAtivacaoMotorista,
  falarTexto,
  restaurarPreferenciaCopiloto
} from './ia/motorista-ia.js';
import { notificar, confirmarAcao } from './util/alertas-huby.js';

function validarAutenticacaoMotorista() {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || token === 'null' || token === 'undefined') {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  if (role && role !== 'motorista' && role !== 'admin') {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  return true;
}

export function atualizarTextosPercentualRepasse() {
  const taxa = Number(TAXA_PLATAFORMA_ATUAL || 15);
  const pctLiquido = Math.max(1, 100 - taxa);

  const lblCarteira = document.querySelector('.wallet-meta small');
  if (lblCarteira) lblCarteira.textContent = `Saldo Disponível (${pctLiquido}%)`;

  const lblRepasseMeta = document.getElementById('lblRepassePctMotorista');
  if (lblRepasseMeta) lblRepasseMeta.textContent = `${pctLiquido}% repasse líquido`;
}

export function atualizarBarraMetaDiaria(novoValorMeta = null) {
  if (novoValorMeta !== null && !isNaN(Number(novoValorMeta)) && Number(novoValorMeta) >= 10) {
    estado.metaDiaria = Number(novoValorMeta);
    localStorage.setItem('huby_meta_diaria', String(estado.metaDiaria));
  }

  const meta = Number(estado.metaDiaria || localStorage.getItem('huby_meta_diaria') || 200);
  const ganhosTexto = document.getElementById('lblGanhosHojeValor')?.textContent || 'R$ 0,00';
  const ganhosNumerico = Number(
    ganhosTexto.replace(/[^\d,-]/g, '').replace(',', '.')
  ) || Number(estado.ganhosHoje || 0);

  const percentual = meta > 0 ? Math.min(100, Math.round((ganhosNumerico / meta) * 100)) : 0;

  const barra = document.getElementById('barraProgressoMeta');
  const lblMeta = document.getElementById('lblMetaDiariaTxt');

  if (barra) {
    barra.style.width = `${percentual}%`;
    barra.style.background = percentual >= 100 ? '#10B981' : '#38BDF8';
  }
  if (lblMeta) {
    lblMeta.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${percentual}%)`;
  }
}

function configurarMetaDiaria() {
  const btnAbrir = document.getElementById('btnEditarMetaDiaria');
  const modal = document.getElementById('modalMetaDiaria');
  const btnFechar = document.getElementById('btnFecharModalMeta');
  const btnCancelar = document.getElementById('btnCancelarModalMeta');
  const btnSalvar = document.getElementById('btnSalvarMetaDiaria');
  const inputValor = document.getElementById('inputValorMetaDiaria');

  const abrirModalMeta = () => {
    if (!modal) return;
    const metaAtual = Number(estado.metaDiaria || localStorage.getItem('huby_meta_diaria') || 200);
    if (inputValor) inputValor.value = metaAtual.toFixed(2);
    modal.style.display = 'flex';
  };

  const fecharModalMeta = () => {
    if (modal) modal.style.display = 'none';
  };

  if (btnAbrir) {
    btnAbrir.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      abrirModalMeta();
    };
  }

  if (btnFechar) btnFechar.onclick = fecharModalMeta;
  if (btnCancelar) btnCancelar.onclick = fecharModalMeta;

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fecharModalMeta();
  });

  document.querySelectorAll('.btn-fast-meta').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.getAttribute('data-meta');
      if (val && inputValor) inputValor.value = Number(val).toFixed(2);
    };
  });

  if (btnSalvar) {
    btnSalvar.onclick = () => {
      const valorDigitado = parseFloat(inputValor?.value);
      if (!valorDigitado || valorDigitado < 10) {
        notificar('Informe uma meta diária a partir de R$ 10,00.', 'alerta');
        return;
      }

      atualizarBarraMetaDiaria(valorDigitado);
      fecharModalMeta();
      notificar(`🎯 Meta diária atualizada para R$ ${valorDigitado.toFixed(2).replace('.', ',')}!`, 'sucesso');
    };
  }

  atualizarBarraMetaDiaria();
}

function configurarCodigoVozDireto() {
  const inputComando = document.getElementById('drawerInputCodigoVoz');
  const btnSalvarComando = document.getElementById('btnSalvarCodigoVoz');
  const btnTestarComando = document.getElementById('btnTestarCodigoVoz');

  if (inputComando) {
    inputComando.value = obterCodigoAtivacaoMotorista();
  }

  if (btnSalvarComando && inputComando) {
    btnSalvarComando.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const valorDigitado = (inputComando.value || '').trim();

      if (!valorDigitado) {
        notificar('Digite uma palavra-chave para ativar o copiloto.', 'alerta');
        inputComando.focus();
        return;
      }

      await definirCodigoAtivacaoMotorista(valorDigitado);
      notificar(`Comando de ativação salvo com sucesso!`, 'sucesso');
    });
  }

  if (btnTestarComando && inputComando) {
    btnTestarComando.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comandoAtual = (inputComando.value || '').trim() || obterCodigoAtivacaoMotorista();
      falarTexto(`Olá. Esta é a configuração da minha voz. Basta me chamar por ${comandoAtual}.`);
    });
  }
}

function escutarAtualizacaoTarifasTempoReal() {
  try {
    const token = localStorage.getItem('huby_token') || '';
    const socket = estado.socket || (window.io ? window.io(API_URL, { auth: { token } }) : null);
    if (socket) {
      socket.on('tarifas_atualizadas', (novasTarifas) => {
        aplicarObjetoTarifas(novasTarifas);
        atualizarTextosPercentualRepasse();
        iniciarRadarChamadas();
      });
    }
  } catch (e) {}
}

// ============================================================================
// BOTÃO EXCLUSIVO DE CANCELAMENTO NA TELA DO MOTORISTA
// ============================================================================
export async function cancelarCorridaPeloMotorista(pedidoIdAlvo = null) {
  const pedidoId =
    pedidoIdAlvo ||
    estado.pedidoAceitoAtual?.id ||
    estado.pedidoAtivo?.id ||
    estado.corridaAtiva?.id ||
    localStorage.getItem('huby_corrida_ativa_mot_id');

  if (!pedidoId) {
    notificar('Nenhuma corrida ativa encontrada para cancelar.', 'alerta');
    return;
  }

  const executarCancelamento = async () => {
    const token = localStorage.getItem('huby_token') || '';
    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/cancelar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ motivo: 'Cancelado pelo motorista parceiro' })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.erro || 'Não foi possível cancelar a corrida.');

      estado.pedidoAceitoAtual = null;
      estado.pedidoAtivo = null;
      estado.corridaAtiva = null;
      estado.pedidoEmAnalise = null;
      localStorage.removeItem('huby_corrida_ativa_mot_id');

      document.getElementById('btnCancelarCorridaMotoristaDock')?.remove();

      const btnChat = document.getElementById('btnAbrirChat');
      if (btnChat) btnChat.style.display = 'none';

      notificar(data.mensagem || 'Corrida cancelada com sucesso.', 'aviso');
      iniciarRadarChamadas();
    } catch (err) {
      notificar(err.message, 'erro');
    }
  };

  if (typeof confirmarAcao === 'function') {
    confirmarAcao({
      titulo: 'Cancelar Corrida?',
      mensagem: 'Confirma o cancelamento desta viagem? O passageiro será notificado.',
      textoConfirmar: 'Confirmar Cancelamento',
      onConfirmar: executarCancelamento
    });
  } else if (window.confirm('Confirma o cancelamento desta corrida?')) {
    await executarCancelamento();
  }
}

window.cancelarCorridaPeloMotorista = cancelarCorridaPeloMotorista;

function configurarBotaoCancelarNaTelaMotorista() {
  const dock = document.querySelector('.driver-dock');
  const feed = document.getElementById('listaChamadasPendentes');
  if (!dock || !feed) return;

  const garantirBotaoCancelar = () => {
    const pedidoAtual = estado.pedidoAceitoAtual || estado.pedidoAtivo || estado.corridaAtiva;
    const corridaId = pedidoAtual?.id || localStorage.getItem('huby_corrida_ativa_mot_id');
    const btnExistente = document.getElementById('btnCancelarCorridaMotoristaDock');

    if (!corridaId) {
      if (btnExistente) btnExistente.remove();
      return;
    }

    const botoesNoDock = Array.from(dock.querySelectorAll('button'));
    const jaExisteBotaoCancelarNoCard = botoesNoDock.some((btn) => {
      if (btn.id === 'btnCancelarCorridaMotoristaDock') return false;
      const texto = (btn.textContent || '').toLowerCase();
      return texto.includes('cancelar');
    });

    if (jaExisteBotaoCancelarNoCard) {
      if (btnExistente) btnExistente.remove();
      return;
    }

    if (btnExistente) return;

    const btnCancelar = document.createElement('button');
    btnCancelar.type = 'button';
    btnCancelar.id = 'btnCancelarCorridaMotoristaDock';
    btnCancelar.innerHTML = '❌ Cancelar Corrida';
    btnCancelar.style.cssText = [
      'width: 100%',
      'margin: 8px 0 10px',
      'padding: 12px',
      'border-radius: 12px',
      'background: rgba(239, 68, 68, 0.16)',
      'border: 1.5px solid rgba(239, 68, 68, 0.5)',
      'color: #F87171',
      'font-size: 13px',
      'font-weight: 900',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'gap: 6px'
    ].join(';');

    btnCancelar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelarCorridaPeloMotorista(corridaId);
    });

    feed.insertAdjacentElement('afterend', btnCancelar);
  };

  const observer = new MutationObserver(() => {
    garantirBotaoCancelar();
  });
  observer.observe(dock, { childList: true, subtree: true });
  setInterval(garantirBotaoCancelar, 1000);
}

// ============================================================================
// HISTÓRICO DETALHADO DE CORRIDAS E REPASSES DO MOTORISTA
// ============================================================================
function configurarHistoricoCorridasMotorista() {
  const drawerContent = document.querySelector('#driverDrawer .drawer-content');
  if (!drawerContent || document.getElementById('btnAbrirHistoricoMotorista')) return;

  const btnHistorico = document.createElement('button');
  btnHistorico.type = 'button';
  btnHistorico.id = 'btnAbrirHistoricoMotorista';
  btnHistorico.style.cssText = [
    'width: 100%',
    'margin-bottom: 12px',
    'padding: 13px 14px',
    'border-radius: 12px',
    'background: rgba(56, 189, 248, 0.14)',
    'border: 1.5px solid rgba(56, 189, 248, 0.4)',
    'color: #38BDF8',
    'font-weight: 900',
    'font-size: 13px',
    'cursor: pointer',
    'display: flex',
    'align-items: center',
    'justify-content: space-between'
  ].join(';');
  btnHistorico.innerHTML = `
    <span>📋 Minhas Corridas & Ganhos</span>
    <span style="font-size: 11px; background: rgba(56,189,248,0.2); padding: 2px 8px; border-radius: 999px;">Ver extrato</span>
  `;

  drawerContent.insertAdjacentElement('afterbegin', btnHistorico);

  btnHistorico.addEventListener('click', async () => {
    document.getElementById('driverDrawer')?.classList.remove('active');
    document.getElementById('drawerOverlay')?.classList.remove('active');
    abrirModalHistoricoDetalhadoMotorista();
  });
}

async function abrirModalHistoricoDetalhadoMotorista() {
  document.getElementById('modalHistoricoDetalhadoMotorista')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modalHistoricoDetalhadoMotorista';
  overlay.className = 'modal-backdrop-custom active';
  overlay.style.cssText = 'display:flex; z-index:10030;';
  overlay.innerHTML = `
    <div class="modal-box-edit" style="max-width: 440px; max-height: 86dvh; display: flex; flex-direction: column; padding: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div>
          <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: #FFF;">📋 Minhas Corridas & Ganhos</h3>
          <small style="color: #94A3B8; font-size: 11px;">Detalhamento transparente de repasse líquido, taxa e avaliação</small>
        </div>
        <button type="button" id="btnFecharHistMot" style="background: rgba(255,255,255,0.08); border: none; color: #FFF; width: 32px; height: 32px; border-radius: 50%; cursor: pointer;">✕</button>
      </div>
      <div id="listaCorridasDetalhadasMot" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
        <div style="text-align: center; color: #94A3B8; padding: 24px 0;">Carregando histórico de viagens...</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btnFecharHistMot').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const listaEl = overlay.querySelector('#listaCorridasDetalhadasMot');
  const token = localStorage.getItem('huby_token') || '';
  const taxaPct = Number(TAXA_PLATAFORMA_ATUAL ?? 15);
  const fatorMot = Math.max(0.1, (100 - taxaPct) / 100);

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const corridas = await resp.json();

    if (!Array.isArray(corridas) || corridas.length === 0) {
      listaEl.innerHTML = `<div style="text-align:center; color:#94A3B8; padding:30px 10px;">Nenhuma corrida registrada no seu histórico ainda.</div>`;
      return;
    }

    listaEl.innerHTML = corridas.map((c) => {
      const bruto = Number(c.valor_total || 0);
      const liquido = Number((bruto * fatorMot).toFixed(2));
      const taxa = Number((bruto - liquido).toFixed(2));
      const dataFmt = c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
      const nota = c.avaliacao_nota ? `⭐ ${Number(c.avaliacao_nota).toFixed(1)}` : 'Sem avaliação';
      const st = String(c.status || '').toLowerCase();
      const corSt = st === 'concluido' ? '#10B981' : (st === 'cancelado' ? '#EF4444' : '#38BDF8');

      return `
        <div style="background: #090D16; border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; color: #94A3B8; font-weight: 700;">#${String(c.id).slice(-4)} • ${dataFmt}</span>
            <span style="font-size: 10px; font-weight: 900; color: ${corSt}; text-transform: uppercase; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 6px;">${c.status}</span>
          </div>
          <div style="font-size: 12.5px; color: #E2E8F0; margin-bottom: 8px; line-height: 1.35;">
            <div><strong style="color:#10B981;">A</strong> ${c.origem_endereco || 'Origem'}</div>
            <div><strong style="color:#EF4444;">B</strong> ${c.destino_endereco || 'Destino'}</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 10px; font-size: 11px;">
            <div>
              <small style="color:#94A3B8; display:block;">Seu Ganho</small>
              <strong style="color:#10B981; font-size:13px;">R$ ${liquido.toFixed(2).replace('.', ',')}</strong>
            </div>
            <div>
              <small style="color:#94A3B8; display:block;">Taxa (${taxaPct}%)</small>
              <strong style="color:#F59E0B;">R$ ${taxa.toFixed(2).replace('.', ',')}</strong>
            </div>
            <div style="text-align:right;">
              <small style="color:#94A3B8; display:block;">Avaliação</small>
              <strong style="color:#FBBF24;">${nota}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    listaEl.innerHTML = `<div style="text-align:center; color:#EF4444; padding:24px 0;">Falha ao carregar histórico de corridas.</div>`;
  }
}

// ============================================================================
// CHAT DE SUPORTE CORPORATIVO & IA COM RESPOSTAS DINÂMICAS E FORMAIS
// ============================================================================
function inicializarChatSuporteIA() {
  const btnAbrir = document.getElementById('btnAbrirChatSuporte');
  const btnFechar = document.getElementById('btnFecharChatSuporte');
  const modal = document.getElementById('modalChatSuporteIA');
  const inputMsg = document.getElementById('inputMsgSuporte');
  const btnEnviar = document.getElementById('btnEnviarMsgSuporte');
  const areaMensagens = document.getElementById('suporteAreaMensagens');

  if (!btnAbrir || !modal) return;

  const CHAT_STORAGE_KEY = 'huby_suporte_chat_history';
  const TEMPO_EXPIRACAO_MS = 24 * 60 * 60 * 1000;

  function carregarHistorico() {
    try {
      const dataString = localStorage.getItem(CHAT_STORAGE_KEY);
      if (!dataString) return [];

      const data = JSON.parse(dataString);
      const agora = new Date().getTime();

      if (data.ultimaAtualizacao && (agora - data.ultimaAtualizacao > TEMPO_EXPIRACAO_MS)) {
        localStorage.removeItem(CHAT_STORAGE_KEY);
        return [];
      }
      return data.mensagens || [];
    } catch (e) {
      return [];
    }
  }

  function salvarHistorico(mensagens) {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
      ultimaAtualizacao: new Date().getTime(),
      mensagens: mensagens
    }));
  }

  function renderizarMensagem(msg) {
    const isUser = msg.autor === 'user';
    const isAdmin = msg.autor === 'admin';
    const alignSelf = isUser ? 'flex-end' : 'flex-start';

    const bgColor = isUser ? '#38BDF8' : (isAdmin ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.1)');
    const color = isUser ? '#02131D' : '#FFF';
    const border = isUser ? 'none' : (isAdmin ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(16, 185, 129, 0.3)');
    const borderRadius = isUser ? '12px 12px 0 12px' : '0 12px 12px 12px';
    const textAlign = isUser ? 'right' : 'left';

    const divWrapper = document.createElement('div');
    divWrapper.style.cssText = `align-self: ${alignSelf}; max-width: 85%;`;

    const divMsg = document.createElement('div');
    divMsg.style.cssText = `background: ${bgColor}; border: ${border}; color: ${color}; padding: 12px; border-radius: ${borderRadius}; font-size: 13px; line-height: 1.5;`;

    if (isAdmin) {
      divMsg.innerHTML = `<strong style="color: #38BDF8; display: block; margin-bottom: 6px; font-size: 11px; text-transform: uppercase;">🛡️ Equipe HUBy</strong> ${msg.texto}`;
    } else {
      divMsg.innerHTML = msg.texto;
    }

    const smallTime = document.createElement('small');
    smallTime.style.cssText = `display: block; color: #64748B; font-size: 10px; margin-top: 4px; text-align: ${textAlign};`;
    const horaFormatada = new Date(msg.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    smallTime.textContent = horaFormatada;

    divWrapper.appendChild(divMsg);
    divWrapper.appendChild(smallTime);
    areaMensagens.appendChild(divWrapper);
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  }

  function renderizarChatInteiro() {
    areaMensagens.innerHTML = '';
    const mensagens = carregarHistorico();

    if (mensagens.length === 0) {
      const msgInicial = {
        autor: 'ia',
        texto: 'Olá! Sou o Assistente Virtual da HUBy. Como posso auxiliar na sua jornada hoje?<br><br><small style="color: #94A3B8;">Por favor, descreva detalhadamente a sua solicitação.</small>',
        data: new Date().getTime()
      };
      mensagens.push(msgInicial);
      salvarHistorico(mensagens);
    }

    mensagens.forEach(renderizarMensagem);
  }

  async function escalarParaCentral(mensagemTexto, assuntoCategoria = 'Suporte HUBy') {
    const token = localStorage.getItem('huby_token');
    try {
      await fetch(`${API_URL}/api/suporte/chamado`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pedido_id: null,
          assunto: assuntoCategoria,
          mensagem: mensagemTexto
        })
      });
    } catch (e) {}
  }

  async function enviarMensagem() {
    const texto = inputMsg.value.trim();
    if (!texto) return;

    inputMsg.value = '';

    const novaMensagem = { autor: 'user', texto: texto, data: new Date().getTime() };
    const mensagens = carregarHistorico();
    mensagens.push(novaMensagem);
    salvarHistorico(mensagens);
    renderizarMensagem(novaMensagem);

    const btnTexto = btnEnviar.innerHTML;
    btnEnviar.innerHTML = '⏳';
    btnEnviar.disabled = true;

    setTimeout(async () => {
      let respostaTexto = '';
      let categoriaTicket = 'Suporte Geral';
      const txt = texto.toLowerCase();

      if (txt.includes('pagamento') || txt.includes('saque') || txt.includes('dinheiro') || txt.includes('pix') || txt.includes('receber')) {
        respostaTexto = 'Compreendido. Para questões financeiras e de repasse, solicitamos que verifique a aba "Ganhos" e confirme a exatidão da sua chave Pix. O seu relato foi encaminhado para o departamento financeiro para análise de pendências.';
        categoriaTicket = 'Auditoria Financeira';
      } else if (txt.includes('passageiro') || txt.includes('cliente') || txt.includes('corrida') || txt.includes('viagem') || txt.includes('bagagem')) {
        respostaTexto = 'A segurança e a excelência no atendimento são fundamentais na HUBy. O seu relato sobre a viagem foi devidamente registrado e direcionado para a nossa equipe de qualidade.';
        categoriaTicket = 'Auditoria de Viagem';
      } else if (txt.includes('aplicativo') || txt.includes('erro') || txt.includes('bug') || txt.includes('mapa') || txt.includes('travar')) {
        respostaTexto = 'Agradecemos o apontamento. A nossa equipe técnica foi notificada sobre este comportamento no aplicativo e trabalhará para garantir a estabilidade do sistema.';
        categoriaTicket = 'Suporte Técnico App';
      } else {
        respostaTexto = 'Agradecemos o seu contato. A solicitação foi registrada com sucesso no sistema da HUBy. O caso será analisado e, se necessária uma intervenção, retornaremos através deste canal de atendimento.';
      }

      await escalarParaCentral(texto, categoriaTicket);

      const respostaIA = { autor: 'ia', texto: respostaTexto, data: new Date().getTime() };
      const mensagensAtuais = carregarHistorico();
      mensagensAtuais.push(respostaIA);
      salvarHistorico(mensagensAtuais);
      renderizarMensagem(respostaIA);

      btnEnviar.innerHTML = btnTexto;
      btnEnviar.disabled = false;
      inputMsg.focus();
    }, 1400);
  }

  btnAbrir.addEventListener('click', (e) => {
    e.preventDefault();
    renderizarChatInteiro();
    modal.style.display = 'flex';
  });

  btnFechar.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  btnEnviar.addEventListener('click', enviarMensagem);

  inputMsg.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagem();
  });

  const token = localStorage.getItem('huby_token') || '';
  const socket = window.io ? window.io(API_URL, { auth: { token } }) : null;
  if (socket) {
    socket.on('resposta_suporte_admin', (dados) => {
      if (dados && dados.resposta) {
        const respostaAdmin = {
          autor: 'admin',
          texto: dados.resposta,
          data: dados.data || new Date().getTime()
        };
        const mensagensAtuais = carregarHistorico();
        mensagensAtuais.push(respostaAdmin);
        salvarHistorico(mensagensAtuais);

        if (modal.style.display === 'flex') {
          renderizarMensagem(respostaAdmin);
        } else {
          notificar('Recebeu um novo retorno da Administração HUBy no suporte.', 'aviso');
        }
      }
    });
  }
}

function registrarEventosUI() {
  const btnOnline = document.getElementById('btnToggleStatusOnline');
  if (btnOnline) {
    btnOnline.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await alternarStatusOnline();
    };
  }

  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');

  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
  });

  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };

  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  if (typeof configurarChatMotorista === 'function') configurarChatMotorista();
  if (typeof configurarEventosSaque === 'function') configurarEventosSaque();
  if (typeof configurarSalvarPreferenciasPagto === 'function') configurarSalvarPreferenciasPagto();
  if (typeof configurarEdicaoPerfil === 'function') configurarEdicaoPerfil();
  if (typeof configurarMarketplace === 'function') configurarMarketplace();
  if (typeof configurarModosInteligentes === 'function') configurarModosInteligentes();

  configurarHistoricoCorridasMotorista();
  configurarMetaDiaria();
  configurarCodigoVozDireto();
  configurarBotaoCancelarNaTelaMotorista();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!validarAutenticacaoMotorista()) return;

  await sincronizarTarifasServidor();
  atualizarTextosPercentualRepasse();

  inicializarSocket();
  escutarAtualizacaoTarifasTempoReal();
  inicializarMapa();
  inicializarZonasRiscoMapa();
  registrarEventosUI();
  await carregarPerfil();
  atualizarBarraMetaDiaria();
  iniciarRadarChamadas();
  inicializarPushNotifications();
  processarFilaOfflineMotorista();

  inicializarCopilotoVoz();
  restaurarPreferenciaCopiloto();

  inicializarChatSuporteIA();
});