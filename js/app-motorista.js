/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Sincronizada em Tempo Real + Controle Exclusivo de Cancelamento pelo Motorista
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
  const inputComando = document.getElementById('drawerInputCodigoVoz') || document.getElementById('inputCodigoVozMotorista');
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
        notificar('Digite uma palavra-chave para ativar seu copiloto (Ex: Zanix, Zank, Falcão).', 'alerta');
        inputComando.focus();
        return;
      }

      await definirCodigoAtivacaoMotorista(valorDigitado);
      notificar(`Comando "${valorDigitado}" salvo com sucesso!`, 'sucesso');
    });
  }

  if (btnTestarComando && inputComando) {
    btnTestarComando.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comandoAtual = (inputComando.value || '').trim() || obterCodigoAtivacaoMotorista();
      falarTexto(`Olá parceiro! Essa é a minha voz configurada. Basta me chamar por ${comandoAtual}.`);
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
      mensagem: 'Tem certeza que deseja cancelar esta viagem? O passageiro será notificado imediatamente.',
      textoConfirmar: 'Sim, Cancelar Corrida',
      onConfirmar: executarCancelamento
    });
  } else if (window.confirm('Tem certeza que deseja cancelar esta corrida?')) {
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

    // Evita duplicação caso o cartão ativo dentro do dock já contenha um botão de cancelar
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
  registrarEventosUI();
  await carregarPerfil();
  atualizarBarraMetaDiaria();
  iniciarRadarChamadas();
  inicializarPushNotifications();

  inicializarCopilotoVoz();
  restaurarPreferenciaCopiloto();
});