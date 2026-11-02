// js/cliente/cliente-avaliacao.js - Avaliação, Tags e Gorjetas do Passageiro
import { API_URL, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { carregarSaldoCarteiraCliente } from './cliente-ui-menu.js';

export function configurarModalAvaliacao() {
  // 1. Controle das Estrelas (1 a 5)
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(star => {
    star.addEventListener('click', () => {
      estadoCliente.notaSelecionada = parseInt(star.getAttribute('data-val'), 10) || 5;
      estrelas.forEach((s, idx) => {
        s.style.color = idx < estadoCliente.notaSelecionada ? '#F59E0B' : '#4B5563';
      });
    });
  });

  // 2. Tags/Etiquetas de Avaliação Rápida (se existirem no HTML)
  document.querySelectorAll('.tag-avaliacao-rapida').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      if (tag.classList.contains('active')) {
        tag.style.background = 'rgba(16, 185, 129, 0.2)';
        tag.style.borderColor = '#10B981';
        tag.style.color = '#10B981';
      } else {
        tag.style.background = 'rgba(255, 255, 255, 0.05)';
        tag.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        tag.style.color = '#94A3B8';
      }
    });
  });

  // 3. Botões de Ação
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
      const jaAtivo = btn.classList.contains('active');
      btnGorjetas.forEach(b => {
        b.classList.remove('active');
        b.style.background = 'rgba(255, 255, 255, 0.05)';
        b.style.color = '#FFF';
      });

      if (!jaAtivo) {
        btn.classList.add('active');
        btn.style.background = '#10B981';
        btn.style.color = '#02261C';
        estadoCliente.gorjetaSelecionada = Number(btn.getAttribute('data-valor') || 0);
      } else {
        estadoCliente.gorjetaSelecionada = 0;
      }
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

  document.querySelectorAll('.btn-gorjeta').forEach(b => {
    b.classList.remove('active');
    b.style.background = 'rgba(255, 255, 255, 0.05)';
    b.style.color = '#FFF';
  });

  document.querySelectorAll('.tag-avaliacao-rapida').forEach(t => {
    t.classList.remove('active');
    t.style.background = 'rgba(255, 255, 255, 0.05)';
    t.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    t.style.color = '#94A3B8';
  });

  estadoCliente.corridaParaAvaliarId = null;
  localStorage.removeItem('huby_pedido_ativo_id');
}

export async function enviarAvaliacaoCorrida() {
  const pedidoId = estadoCliente.corridaParaAvaliarId || localStorage.getItem('huby_pedido_ativo_id');
  if (!pedidoId) {
    fecharModalAvaliacao();
    return;
  }

  const token = localStorage.getItem('huby_token');
  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  const comentario = comentarioEl ? comentarioEl.value.trim() : '';
  const btn = document.getElementById('btnEnviarAvaliacao');

  // Coleta as etiquetas marcadas (se existirem)
  const tagsAtivas = [];
  document.querySelectorAll('.tag-avaliacao-rapida.active').forEach(t => {
    tagsAtivas.push(t.textContent.trim());
  });

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    // 1. Enviar Avaliação com Nota, Comentário e Tags
    const resAvaliacao = await fetch(`${API_URL}/api/pedidos/${pedidoId}/avaliar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        nota: estadoCliente.notaSelecionada || 5,
        comentario,
        etiquetas: tagsAtivas
      })
    });

    // 2. Enviar Gorjeta (se selecionada)
    if (estadoCliente.gorjetaSelecionada > 0) {
      const resGorjeta = await fetch(`${API_URL}/api/carteira/gorjeta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pedidoId,
          valorGorjeta: estadoCliente.gorjetaSelecionada
        })
      });

      if (resGorjeta.ok) {
        await carregarSaldoCarteiraCliente();
      }
    }

    if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
      sonsHUBy.tocarMetaBatida();
    }

    alert('⭐ Obrigado pela sua avaliação! Sua opinião ajuda a manter a comunidade HUBy excelente.');
  } catch (err) {
    console.warn('Erro ao processar avaliação:', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Avaliação';
    }
    fecharModalAvaliacao();
  }
}