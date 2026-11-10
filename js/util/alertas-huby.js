// js/util/alertas-huby.js - Biblioteca de Alertas e Modais Elegantes HUBy
import { sonsHUBy } from '../config.js';

// Garantir container de toasts no DOM
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
 * Exibe notificação flutuante elegante (Toast)
 * @param {string} mensagem - Texto principal da notificação
 * @param {'sucesso'|'erro'|'alerta'|'info'} tipo - Categoria visual
 * @param {number} duracao - Tempo de exibição em ms (padrão: 3600ms)
 */
export function notificar(mensagem, tipo = 'info', duracao = 3600) {
  const container = obterContainerToasts();

  const icones = {
    sucesso: '✓',
    erro: '✕',
    alerta: '⚠️',
    info: 'ℹ️'
  };

  const titulos = {
    sucesso: 'Sucesso',
    erro: 'Atenção',
    alerta: 'Importante',
    info: 'HUBy Informa'
  };

  const icone = icones[tipo] || 'ℹ️';
  const titulo = titulos[tipo] || 'Aviso';

  const toast = document.createElement('div');
  toast.className = `huby-toast huby-toast-${tipo}`;

  toast.innerHTML = `
    <div class="huby-toast-icone">${icone}</div>
    <div class="huby-toast-conteudo">
      <div class="huby-toast-titulo">${titulo}</div>
      <div class="huby-toast-msg">${mensagem}</div>
    </div>
    <div class="huby-toast-barra" style="animation-duration: ${duracao}ms;"></div>
  `;

  // Tocar som correspondente, se disponível
  try {
    if (tipo === 'sucesso' && sonsHUBy?.tocarSucessoAceite) {
      sonsHUBy.tocarSucessoAceite();
    } else if (tipo === 'alerta' && sonsHUBy?.tocarAlertaChamada) {
      sonsHUBy.tocarAlertaChamada();
    }
  } catch (e) {}

  container.appendChild(toast);

  // Fechar ao tocar
  toast.addEventListener('click', () => fecharToast(toast));

  // Remoção automática após a duração
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
  }, 260);
}

/**
 * Diálogo de confirmação moderno (substituto do window.confirm)
 * @param {Object} opcoes
 * @param {string} opcoes.titulo
 * @param {string} opcoes.mensagem
 * @param {string} [opcoes.textoConfirmar='Confirmar']
 * @param {string} [opcoes.textoCancelar='Cancelar']
 * @param {boolean} [opcoes.perigo=false] - Botão principal vermelho
 * @returns {Promise<boolean>}
 */
export function confirmarAcao({
  titulo = 'Confirmar Ação',
  mensagem = 'Deseja prosseguir com esta operação?',
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false
}) {
  return new Promise((resolve) => {
    // Remover modal anterior se existir
    document.getElementById('hubyModalOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hubyModalOverlay';

    overlay.innerHTML = `
      <div class="huby-modal-box">
        <div class="huby-modal-icone-wrapper">
          <span>${perigo ? '🚨' : '❓'}</span>
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

    function fechar(resultado) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
      resolve(resultado);
    }

    btnConfirmar.addEventListener('click', () => fechar(true));
    btnCancelar.addEventListener('click', () => fechar(false));
  });
}

// Interceptar o alert padrão do navegador para usar o visual HUBy
if (typeof window !== 'undefined') {
  window.hubyNotificar = notificar;
  window.hubyConfirmar = confirmarAcao;
}