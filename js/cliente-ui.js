// js/cliente-ui.js - Toasts e Diálogos Elegantes para o Passageiro
export function notificarCliente(mensagem, tipo = 'info') {
  let container = document.getElementById('hubyClientToast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'hubyClientToast';
    container.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top, 14px) + 12px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 10050;
      width: 90%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  // Remove notificações anteriores para não acumular nem sobrepor o topo
  container.innerHTML = '';

  const icones = { sucesso: '✅', alerta: '⚠️', info: '📍', erro: '❌' };
  const bordas = {
    sucesso: '#10B981',
    alerta: '#F59E0B',
    info: '#38BDF8',
    erro: '#EF4444'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(13, 18, 30, 0.95);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 4px solid ${bordas[tipo] || bordas.info};
    border-radius: 14px;
    padding: 10px 14px;
    color: #FFF;
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 10px 28px rgba(0,0,0,0.65);
    pointer-events: auto;
    opacity: 0;
    transform: translateY(-8px);
    transition: all 0.25s ease;
  `;

  toast.innerHTML = `<span>${icones[tipo] || '💡'}</span><div style="flex:1; line-height: 1.3;">${mensagem}</div>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}
// Modal escuro translúcido substituindo prompt()
export function abrirPromptParada({ titulo, placeholder, onConfirmar }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(5, 8, 15, 0.85);
    backdrop-filter: blur(10px);
    z-index: 10060;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
  `;

  overlay.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 22px; width: 100%; max-width: 350px; box-shadow: 0 20px 40px rgba(0,0,0,0.7);">
      <h3 style="margin: 0 0 8px; font-size: 16px; color: #FFF; font-weight: 800;">${titulo}</h3>
      <p style="color: #94A3B8; font-size: 12px; margin: 0 0 14px;">Adicione um ponto intermediário à rota:</p>
      <input type="text" id="inputCustomParada" placeholder="${placeholder}"
        style="width: 100%; box-sizing: border-box; background: #080C14; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px; color: #FFF; font-size: 13px; font-weight: 600; outline: none; margin-bottom: 16px;">
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnCancelParada"
          style="flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #FFF; padding: 12px; border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer;">Cancelar</button>
        <button type="button" id="btnOkParada"
          style="flex: 1.3; background: #38BDF8; border: none; color: #000; padding: 12px; border-radius: 10px; font-weight: 900; font-size: 13px; cursor: pointer;">Adicionar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const input = overlay.querySelector('#inputCustomParada');
  input.focus();

  const fechar = () => overlay.remove();
  overlay.querySelector('#btnCancelParada').addEventListener('click', fechar);
  overlay.querySelector('#btnOkParada').addEventListener('click', () => {
    const val = input.value.trim();
    fechar();
    if (val && typeof onConfirmar === 'function') onConfirmar(val);
  });
}