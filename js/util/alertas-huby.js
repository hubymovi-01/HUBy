// js/util/alertas-huby.js - Biblioteca de Alertas e Modais Limpos HUBy
import { sonsHUBy } from '../config.js';

let ultimaMensagemTexto = '';
let ultimaMensagemTimestamp = 0;

function obterContainerToasts() {
  let container = document.getElementById('hubyToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'hubyToastContainer';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Exibe notificação flutuante compacta e organizada (Toast)
 * @param {string} mensagem - Texto principal da notificação
 * @param {'sucesso'|'erro'|'alerta'|'info'|'aviso'} tipo - Categoria visual
 * @param {number} duracao - Tempo de exibição em ms (padrão: 3200ms)
 */
export function notificar(mensagem, tipo = 'info', duracao = 3200) {
  const textoLimpo = String(mensagem || '').trim();
  if (!textoLimpo) return;

  // Evita spam da mesma notificação em menos de 1,8s
  const agora = Date.now();
  if (textoLimpo === ultimaMensagemTexto && (agora - ultimaMensagemTimestamp) < 1800) {
    return;
  }
  ultimaMensagemTexto = textoLimpo;
  ultimaMensagemTimestamp = agora;

  const tipoNormalizado = tipo === 'aviso' ? 'alerta' : tipo;
  const container = obterContainerToasts();

  // Mantém no máximo 2 notificações visíveis para não poluir a tela
  const existentes = container.querySelectorAll('.huby-toast:not(.saindo)');
  if (existentes.length >= 2) {
    fecharToast(existentes[0]);
  }

  const icones = {
    sucesso: '✓',
    erro: '✕',
    alerta: '!',
    info: 'i'
  };

  const titulos = {
    sucesso: 'Concluído',
    erro: 'Erro',
    alerta: 'Aviso',
    info: 'HUBy'
  };

  const icone = icones[tipoNormalizado] || 'i';
  const titulo = titulos[tipoNormalizado] || 'HUBy';

  const toast = document.createElement('div');
  toast.className = `huby-toast huby-toast-${tipoNormalizado}`;

  toast.innerHTML = `
    <div class="huby-toast-icone">${icone}</div>
    <div class="huby-toast-conteudo">
      <div class="huby-toast-titulo">${titulo}</div>
      <div class="huby-toast-msg">${textoLimpo}</div>
    </div>
    <button type="button" class="huby-toast-fechar" aria-label="Fechar">✕</button>
    <div class="huby-toast-barra" style="animation-duration: ${duracao}ms;"></div>
  `;

  try {
    if (tipoNormalizado === 'sucesso' && sonsHUBy?.tocarSucessoAceite) {
      sonsHUBy.tocarSucessoAceite();
    } else if (tipoNormalizado === 'alerta' && sonsHUBy?.tocarAlertaChamada) {
      sonsHUBy.tocarAlertaChamada();
    }
  } catch (e) {}

  container.appendChild(toast);

  toast.addEventListener('click', () => fecharToast(toast));

  const timer = setTimeout(() => {
    fecharToast(toast);
  }, duracao);

  toast._timer = timer;
}

function fecharToast(toast) {
  if (!toast || toast.classList.contains('saindo')) return;
  clearTimeout(toast._timer);
  toast.classList.add('saindo');
  setTimeout(() => {
    toast.remove();
  }, 220);
}

/**
 * Diálogo de confirmação moderno (compatível com callback onConfirmar ou Promise)
 */
export function confirmarAcao({
  titulo = 'Confirmar Ação',
  mensagem = 'Deseja prosseguir com esta operação?',
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false,
  onConfirmar = null,
  onCancelar = null
}) {
  return new Promise((resolve) => {
    document.getElementById('hubyModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hubyModalOverlay';

    overlay.innerHTML = `
      <div class="huby-modal-box">
        <div class="huby-modal-icone-wrapper ${perigo ? 'perigo' : ''}">
          <span>${perigo ? '⚠️' : '❓'}</span>
        </div>
        <h3 class="huby-modal-titulo">${titulo}</h3>
        <p class="huby-modal-descricao">${mensagem}</p>
        <div class="huby-modal-acoes">
          <button type="button" class="huby-btn-alerta huby-btn-cancelar" id="btnHubyModalCancelar">
            ${textoCancelar}
          </button>
          <button type="button" class="huby-btn-alerta huby-btn-confirmar ${perigo ? 'perigo' : ''}" id="btnHubyModalConfirmar">
            ${textoConfirmar}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const btnConfirmar = overlay.querySelector('#btnHubyModalConfirmar');
    const btnCancelar = overlay.querySelector('#btnHubyModalCancelar');

    async function fechar(resultado) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 180);
      if (resultado && typeof onConfirmar === 'function') {
        await onConfirmar();
      } else if (!resultado && typeof onCancelar === 'function') {
        await onCancelar();
      }
      resolve(resultado);
    }

    btnConfirmar.addEventListener('click', () => fechar(true));
    btnCancelar.addEventListener('click', () => fechar(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) fechar(false);
    });
  });
}

if (typeof window !== 'undefined') {
  window.hubyNotificar = notificar;
  window.hubyConfirmar = confirmarAcao;
}