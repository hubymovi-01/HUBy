// js/cliente/cliente-avaliacao.js
import { API_URL } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { carregarSaldoCarteiraCliente } from './cliente-ui-menu.js';

export function configurarModalAvaliacao() {
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(star => {
    star.addEventListener('click', () => {
      estadoCliente.notaSelecionada = parseInt(star.getAttribute('data-val'), 10);
      estrelas.forEach((s, idx) => {
        s.style.color = idx < estadoCliente.notaSelecionada ? '#F59E0B' : '#4B5563';
      });
    });
  });

  document.getElementById('btnEnviarAvaliacao')?.addEventListener('click', enviarAvaliacaoCorrida);
  document.getElementById('btnPularAvaliacao')?.addEventListener('click', fecharModalAvaliacao);

  const modal = document.getElementById('modalAvaliacao');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fecharModalAvaliacao();
  });
}

export function configurarBotoesGorjeta() {
  const btnGorjetas = document.querySelectorAll('.btn-gorjeta');
  btnGorjetas.forEach(btn => {
    btn.addEventListener('click', () => {
      btnGorjetas.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      estadoCliente.gorjetaSelecionada = Number(btn.getAttribute('data-valor') || 0);
    });
  });
}

export function fecharModalAvaliacao() {
  const modal = document.getElementById('modalAvaliacao');
  if (modal) modal.style.display = 'none';

  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  if (comentarioEl) comentarioEl.value = '';

  estadoCliente.notaSelecionada = 5;
  estadoCliente.gorjetaSelecionada = 0;
  
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(s => s.style.color = '#F59E0B');

  document.querySelectorAll('.btn-gorjeta').forEach(b => b.classList.remove('active'));
  estadoCliente.corridaParaAvaliarId = null;
}

export async function enviarAvaliacaoCorrida() {
  if (!estadoCliente.corridaParaAvaliarId) return;

  const token = localStorage.getItem('huby_token');
  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  const comentario = comentarioEl ? comentarioEl.value : '';
  const btn = document.getElementById('btnEnviarAvaliacao');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    // 1. Enviar Avaliação
    await fetch(`${API_URL}/api/pedidos/${estadoCliente.corridaParaAvaliarId}/avaliar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ nota: estadoCliente.notaSelecionada, comentario })
    });

    // 2. Enviar Gorjeta
    if (estadoCliente.gorjetaSelecionada > 0) {
      const resGorjeta = await fetch(`${API_URL}/api/carteira/gorjeta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pedidoId: estadoCliente.corridaParaAvaliarId,
          valorGorjeta: estadoCliente.gorjetaSelecionada
        })
      });

      if (resGorjeta.ok) {
        await carregarSaldoCarteiraCliente();
      }
    }

    alert('Obrigado pela sua avaliação!');
  } catch (err) {
    console.warn('Erro ao avaliar:', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Avaliação';
    }
    fecharModalAvaliacao();
  }
}