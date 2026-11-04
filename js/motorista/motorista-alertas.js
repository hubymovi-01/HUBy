// js/motorista/motorista-alertas.js - Toasts e Modais de Confirmação HUD/Glass
export function notificar(mensagem, tipo = 'info', tempoMs = 3500) {
  let container = document.getElementById('hubyToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'hubyToastContainer';
    container.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10020;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      width: 90%;
      max-width: 360px;
    `;
    document.body.appendChild(container);
  }

  const icones = {
    sucesso: '✅',
    erro: '⚠️',
    info: '💡',
    alerta: '🔥',
    pausa: '☕',
    casa: '🏠'
  };

  const cores = {
    sucesso: 'rgba(16, 185, 129, 0.95)',
    erro: 'rgba(239, 68, 68, 0.95)',
    info: 'rgba(56, 189, 248, 0.95)',
    alerta: 'rgba(245, 158, 11, 0.95)',
    pausa: 'rgba(139, 92, 246, 0.95)',
    casa: 'rgba(56, 189, 248, 0.95)'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    pointer-events: auto;
    background: rgba(13, 18, 30, 0.92);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-left: 4px solid ${cores[tipo] || cores.info};
    border-radius: 14px;
    padding: 12px 14px;
    color: #FFF;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
    opacity: 0;
    transform: translateY(-12px);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  toast.innerHTML = `
    <span style="font-size: 16px;">${icones[tipo] || '💡'}</span>
    <div style="flex: 1; line-height: 1.3;">${mensagem}</div>
  `;

  container.appendChild(toast);

  // Animação de entrada
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Remoção suave
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 250);
  }, tempoMs);
}

// Diálogo customizado substituindo prompt() do navegador
export function abrirPromptCustom({ titulo, placeholder, valorPadrao = '', onConfirmar }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop-custom';
  overlay.style.cssText = `
    display: flex;
    position: fixed;
    inset: 0;
    background: rgba(5, 8, 15, 0.85);
    backdrop-filter: blur(8px);
    z-index: 10025;
    align-items: center;
    justify-content: center;
    padding: 16px;
  `;

  overlay.innerHTML = `
    <div class="modal-box-edit" style="max-width: 340px; text-align: left; animation: popIn 0.2s ease;">
      <h3 style="margin: 0 0 8px; font-size: 15px; color: #FFF; font-weight: 800;">${titulo}</h3>
      <input type="text" id="promptCustomInput" value="${valorPadrao}" placeholder="${placeholder}"
        style="width: 100%; background: #080C14; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 11px 12px; color: #FFF; font-size: 13px; font-weight: 600; outline: none; margin-bottom: 14px;">
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnPromptCancelar"
          style="flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #FFF; padding: 10px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;">Cancelar</button>
        <button type="button" id="btnPromptConfirmar"
          style="flex: 1.2; background: #38BDF8; border: none; color: #000; padding: 10px; border-radius: 8px; font-size: 12px; font-weight: 900; cursor: pointer;">Confirmar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector('#promptCustomInput');
  input.focus();

  const fechar = () => overlay.remove();

  overlay.querySelector('#btnPromptCancelar').addEventListener('click', fechar);
  overlay.querySelector('#btnPromptConfirmar').addEventListener('click', () => {
    const val = input.value.trim();
    fechar();
    if (val && typeof onConfirmar === 'function') onConfirmar(val);
  });
}