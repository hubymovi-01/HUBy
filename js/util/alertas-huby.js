// js/util/alertas-huby.js - Biblioteca de Alertas e Modais Limpos HUBy
// Todo texto é exibido como TEXTO PURO (nunca vira código na tela).
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

// Cria um elemento com classe e texto (sem interpretar HTML)
function criarEl(tag, classe = '', texto = null) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== null && texto !== undefined) el.textContent = String(texto);
  return el;
}

/**
 * Exibe notificação flutuante compacta e organizada (Toast)
 * @param {string} mensagem - Texto principal da notificação (exibido como texto puro)
 * @param {'sucesso'|'erro'|'alerta'|'info'|'aviso'} tipo - Categoria visual
 * @param {number} duracao - Tempo de exibição em ms (padrão: 3200ms)
 */
export function notificar(mensagem, tipo = 'info', duracao = 3200) {
  const textoLimpo = String(mensagem ?? '').trim().slice(0, 500);
  if (!textoLimpo) return;

  // Evita spam da mesma notificação em menos de 1,8s
  const agora = Date.now();
  if (textoLimpo === ultimaMensagemTexto && (agora - ultimaMensagemTimestamp) < 1800) {
    return;
  }
  ultimaMensagemTexto = textoLimpo;
  ultimaMensagemTimestamp = agora;

  const tiposValidos = ['sucesso', 'erro', 'alerta', 'info'];
  let tipoNormalizado = tipo === 'aviso' ? 'alerta' : tipo;
  if (!tiposValidos.includes(tipoNormalizado)) tipoNormalizado = 'info';

  const duracaoMs = Math.min(Math.max(Number(duracao) || 3200, 1000), 20000);
  const container = obterContainerToasts();

  // Mantém no máximo 2 notificações visíveis para não poluir a tela
  const existentes = container.querySelectorAll('.huby-toast:not(.saindo)');
  if (existentes.length >= 2) {
    fecharToast(existentes[0]);
  }

  const icones = { sucesso: '✓', erro: '✕', alerta: '!', info: 'i' };
  const titulos = { sucesso: 'Concluído', erro: 'Erro', alerta: 'Aviso', info: 'HUBy' };

  const toast = criarEl('div', `huby-toast huby-toast-${tipoNormalizado}`);

  const icone = criarEl('div', 'huby-toast-icone', icones[tipoNormalizado]);
  const conteudo = criarEl('div', 'huby-toast-conteudo');
  conteudo.appendChild(criarEl('div', 'huby-toast-titulo', titulos[tipoNormalizado]));
  const msg = criarEl('div', 'huby-toast-msg', textoLimpo);
  msg.style.whiteSpace = 'pre-line'; // permite quebra de linha com \n
  conteudo.appendChild(msg);

  const btnFechar = criarEl('button', 'huby-toast-fechar', '✕');
  btnFechar.type = 'button';
  btnFechar.setAttribute('aria-label', 'Fechar');

  const barra = criarEl('div', 'huby-toast-barra');
  barra.style.animationDuration = `${duracaoMs}ms`;

  toast.append(icone, conteudo, btnFechar, barra);

  try {
    if (tipoNormalizado === 'sucesso' && sonsHUBy?.tocarSucessoAceite) {
      sonsHUBy.tocarSucessoAceite();
    } else if (tipoNormalizado === 'alerta' && sonsHUBy?.tocarAlertaChamada) {
      sonsHUBy.tocarAlertaChamada();
    }
  } catch (e) {}

  container.appendChild(toast);

  toast.addEventListener('click', () => fecharToast(toast));

  toast._timer = setTimeout(() => {
    fecharToast(toast);
  }, duracaoMs);
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
 * Título, mensagem e textos dos botões são exibidos como texto puro.
 */
export function confirmarAcao({
  titulo = 'Confirmar Ação',
  mensagem = 'Deseja prosseguir com esta operação?',
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigo = false,
  onConfirmar = null,
  onCancelar = null
} = {}) {
  return new Promise((resolve) => {
    document.getElementById('hubyModalOverlay')?.remove();

    const overlay = criarEl('div');
    overlay.id = 'hubyModalOverlay';

    const box = criarEl('div', 'huby-modal-box');

    const iconeWrapper = criarEl('div', `huby-modal-icone-wrapper${perigo ? ' perigo' : ''}`);
    iconeWrapper.appendChild(criarEl('span', '', perigo ? '⚠️' : '❓'));

    const elTitulo = criarEl('h3', 'huby-modal-titulo', titulo);
    const elMensagem = criarEl('p', 'huby-modal-descricao', mensagem);
    elMensagem.style.whiteSpace = 'pre-line';

    const acoes = criarEl('div', 'huby-modal-acoes');
    const btnCancelar = criarEl('button', 'huby-btn-alerta huby-btn-cancelar', textoCancelar);
    btnCancelar.type = 'button';
    btnCancelar.id = 'btnHubyModalCancelar';
    const btnConfirmar = criarEl('button', `huby-btn-alerta huby-btn-confirmar${perigo ? ' perigo' : ''}`, textoConfirmar);
    btnConfirmar.type = 'button';
    btnConfirmar.id = 'btnHubyModalConfirmar';
    acoes.append(btnCancelar, btnConfirmar);

    box.append(iconeWrapper, elTitulo, elMensagem, acoes);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let jaRespondeu = false; // evita confirmar duas vezes com toque duplo

    async function fechar(resultado) {
      if (jaRespondeu) return;
      jaRespondeu = true;
      btnConfirmar.disabled = true;
      btnCancelar.disabled = true;

      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 180);
      try {
        if (resultado && typeof onConfirmar === 'function') {
          await onConfirmar();
        } else if (!resultado && typeof onCancelar === 'function') {
          await onCancelar();
        }
      } catch (e) {
        console.warn('Erro na ação confirmada:', e);
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