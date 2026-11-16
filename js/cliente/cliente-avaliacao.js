// js/cliente/cliente-avaliacao.js - Avaliação com Estrelas, Etiquetas de Elogio e Gorjetas
import { API_URL, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { carregarSaldoCarteiraCliente } from './cliente-ui-menu.js';
import { notificar } from '../util/alertas-huby.js';

const ETIQUETAS_ELOGIO_PADRAO = [
  { id: 'carro_limpo', label: '✨ Carro limpo' },
  { id: 'direcao_tranquila', label: '🛣️ Direção tranquila' },
  { id: 'boa_conversa', label: '💬 Boa conversa' },
  { id: 'pontual', label: '⏱️ Pontual' },
  { id: 'educado', label: '🤝 Muito educado' },
  { id: 'ar_condicionado', label: '❄️ Ar agradável' }
];

function garantirEtiquetasNoModal() {
  const modalCard = document.querySelector('#modalAvaliacao .modal-card');
  const estrelasBox = document.getElementById('estrelasRating');
  if (!modalCard || !estrelasBox) return;

  if (!document.getElementById('containerTagsAvaliacao')) {
    const grid = document.createElement('div');
    grid.id = 'containerTagsAvaliacao';
    grid.className = 'tags-avaliacao-grid';
    grid.innerHTML = ETIQUETAS_ELOGIO_PADRAO.map(
      (tag) => `<button type="button" class="tag-avaliacao-rapida" data-tag="${tag.label}">${tag.label}</button>`
    ).join('');
    estrelasBox.insertAdjacentElement('afterend', grid);
  }
}

export function configurarModalAvaliacao() {
  garantirEtiquetasNoModal();

  // 1. Controle das Estrelas (1 a 5)
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach((star) => {
    star.onclick = () => {
      estadoCliente.notaSelecionada = parseInt(star.getAttribute('data-val'), 10) || 5;
      estrelas.forEach((s, idx) => {
        s.style.color = idx < estadoCliente.notaSelecionada ? '#F59E0B' : '#4B5563';
      });
    };
  });

  // 2. Tags/Etiquetas de Avaliação Rápida
  document.querySelectorAll('.tag-avaliacao-rapida').forEach((tag) => {
    tag.onclick = () => {
      tag.classList.toggle('active');
    };
  });

  // 3. Botões de Ação
  const btnEnviar = document.getElementById('btnEnviarAvaliacao');
  const btnPular = document.getElementById('btnPularAvaliacao');
  if (btnEnviar) btnEnviar.onclick = enviarAvaliacaoCorrida;
  if (btnPular) btnPular.onclick = fecharModalAvaliacao;

  const modal = document.getElementById('modalAvaliacao');
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) fecharModalAvaliacao();
    };
  }
}

export function configurarBotoesGorjeta() {
  const btnGorjetas = document.querySelectorAll('.btn-gorjeta');
  btnGorjetas.forEach((btn) => {
    btn.onclick = () => {
      const jaAtivo = btn.classList.contains('active');
      btnGorjetas.forEach((b) => {
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
    };
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
  estrelas.forEach((s) => {
    s.style.color = '#F59E0B';
  });

  document.querySelectorAll('.btn-gorjeta').forEach((b) => {
    b.classList.remove('active');
    b.style.background = 'rgba(255, 255, 255, 0.05)';
    b.style.color = '#FFF';
  });

  document.querySelectorAll('.tag-avaliacao-rapida').forEach((t) => {
    t.classList.remove('active');
  });

  estadoCliente.corridaParaAvaliarId = null;
  localStorage.removeItem('huby_pedido_ativo_id');
  localStorage.removeItem('huby_ultima_corrida_id');
}

export async function enviarAvaliacaoCorrida() {
  const pedidoId =
    estadoCliente.corridaParaAvaliarId ||
    localStorage.getItem('huby_ultima_corrida_id') ||
    localStorage.getItem('huby_pedido_ativo_id');

  if (!pedidoId) {
    fecharModalAvaliacao();
    return;
  }

  const token = localStorage.getItem('huby_token');
  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  const comentario = comentarioEl ? comentarioEl.value.trim() : '';
  const btn = document.getElementById('btnEnviarAvaliacao');

  const tagsAtivas = [];
  document.querySelectorAll('.tag-avaliacao-rapida.active').forEach((t) => {
    tagsAtivas.push(t.getAttribute('data-tag') || t.textContent.trim());
  });

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

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

    if (!resAvaliacao.ok) {
      const errData = await resAvaliacao.json().catch(() => ({}));
      throw new Error(errData.erro || 'Não foi possível registrar sua avaliação.');
    }

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

    notificar('Avaliação enviada! Obrigado por viajar com a HUBy.', 'sucesso');
  } catch (err) {
    notificar(err.message || 'Erro ao enviar avaliação.', 'erro');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
    fecharModalAvaliacao();
  }
}