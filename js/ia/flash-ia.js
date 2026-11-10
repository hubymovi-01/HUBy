// js/ia/flash-ia.js - Módulo de Preenchimento Automatizado para HUBy Flash
import { API_URL } from '../config.js';
import { vozUI } from './voz-ui.js';
import { notificarCliente } from '../cliente-ui.js';

export function configurarIAFlash() {
  const selectTipo = document.getElementById('selectTipoItem');
  const inputRecebedor = document.getElementById('inputRecebedor');
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');

  if (!blocoEntrega) return;

  // Escuta quando a IA processa uma encomenda
  document.addEventListener('huby_flash_extraido_ia', (e) => {
    const { recebedor, tipoItem, observacao } = e.detail;

    if (inputRecebedor && recebedor) {
      inputRecebedor.value = recebedor;
      inputRecebedor.style.borderColor = '#10B981';
      setTimeout(() => { inputRecebedor.style.borderColor = ''; }, 2500);
    }

    if (selectTipo && tipoItem) {
      const tiposValidos = ['documento', 'pequeno', 'medio', 'fragil'];
      if (tiposValidos.includes(tipoItem)) {
        selectTipo.value = tipoItem;
        selectTipo.style.borderColor = '#10B981';
        setTimeout(() => { selectTipo.style.borderColor = ''; }, 2500);
      }
    }

    if (observacao) {
      const badgeNota = document.getElementById('txtNotaMotoristaBadge');
      if (badgeNota) {
        badgeNota.textContent = `📝 ${observacao}`;
        badgeNota.style.display = 'block';
      }
    }

    notificarCliente('📦 Dados da encomenda preenchidos pela IA!', 'sucesso');
  });
}

// Envia a instrução falada para o backend extrair os dados da entrega
export async function processarComandoFlashIA(textoFalado) {
  try {
    const res = await fetch(`${API_URL}/api/ia/flash-extrair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: textoFalado })
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.sucesso && data.resultado) {
      const evt = new CustomEvent('huby_flash_extraido_ia', {
        detail: data.resultado
      });
      document.dispatchEvent(evt);
      return data.resultado;
    }
  } catch (err) {
    console.warn('⚠️ Falha ao extrair dados de entrega via IA:', err);
  }
  return null;
}