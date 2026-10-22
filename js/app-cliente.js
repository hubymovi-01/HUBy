import { API_URL, CATEGORIAS } from './config.js';
import { HubyMapa } from './mapa.js';

let hubyMapa = null;
let coordsDestino = null;
let rotaAtual = null;
let pedidoAtivoId = null;
let intervalPolling = null;
let categoriaSelecionada = 'carro';

// Controle da Avaliação pós-corrida
let corridaParaAvaliarId = null;
let notaSelecionada = 5;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inicializar o Mapa com a classe HubyMapa
  hubyMapa = new HubyMapa('mapaCliente');
  hubyMapa.inicializar(async (rota, coords) => {
    if (pedidoAtivoId) return; // Não recalcula se a corrida já foi solicitada
    coordsDestino = [coords.lat, coords.lng];
    rotaAtual = rota;

    const txtDestino = document.getElementById('txtDestinoSelecionado');
    if (txtDestino) {
      txtDestino.textContent = `Destino marcado (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
    }

    atualizarResumoValores();
  });

  // Forçar o Leaflet a recalcular as dimensões e renderizar os quadrantes na tela
  setTimeout(() => {
    if (hubyMapa && hubyMapa.map) {
      hubyMapa.map.invalidateSize();
    }
  }, 200);

  // 2. Botão GPS Recenter
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    hubyMapa.obterGPS();
  });

  // Tentar obter localização real inicial
  hubyMapa.obterGPS();

  // 3. Seleção de Categorias
  const chips = document.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      categoriaSelecionada = chip.getAttribute('data-id') || 'carro';
      atualizarBotaoChamar();
      if (rotaAtual) atualizarResumoValores();
    });
  });

  // 4. Botão Pedir / Cancelar HUBy
  const btnPedir = document.getElementById('btnPedirHuby');
  btnPedir?.addEventListener('click', () => {
    if (pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  // 5. Botão de Histórico de Viagens
  document.getElementById('btnAbrirHistorico')?.addEventListener('click', carregarEExibirHistorico);

  // 6. Configurar Interação das Estrelas de Avaliação
  configurarModalAvaliacao();
});

function configurarModalAvaliacao() {
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(star => {
    star.addEventListener('click', () => {
      notaSelecionada = parseInt(star.getAttribute('data-val'), 10);
      estrelas.forEach((s, idx) => {
        s.style.color = idx < notaSelecionada ? '#F59E0B' : '#4B5563';
      });
    });
  });

  // Botão Enviar Avaliação
  document.getElementById('btnEnviarAvaliacao')?.addEventListener('click', enviarAvaliacaoCorrida);

  // Botão Pular Avaliação (Opcional)
  document.getElementById('btnPularAvaliacao')?.addEventListener('click', fecharModalAvaliacao);

  // Fechar ao clicar fora (no backdrop escuro)
  const modal = document.getElementById('modalAvaliacao');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      fecharModalAvaliacao();
    }
  });
}

function fecharModalAvaliacao() {
  const modal = document.getElementById('modalAvaliacao');
  if (modal) modal.style.display = 'none';

  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  if (comentarioEl) comentarioEl.value = '';

  // Reseta para 5 estrelas por padrão
  notaSelecionada = 5;
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(s => s.style.color = '#F59E0B');

  corridaParaAvaliarId = null;
}

function atualizarBotaoChamar() {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn || pedidoAtivoId) return;

  const labels = {
    carro: 'Chamar HUBy Carro',
    moto: 'Chamar HUBy Moto',
    flash_moto: 'Chamar HUBy Flash',
    cargo_pickup: 'Chamar HUBy Frete'
  };
  btn.textContent = labels[categoriaSelecionada] || 'Chamar HUBy';
}

function atualizarResumoValores() {
  if (!rotaAtual) return;

  const km = rotaAtual.distanciaKm;
  const catCfg = CATEGORIAS[categoriaSelecionada]?.tipos?.[0] || { base: 7.0, km: 2.2 };
  const valorBase = catCfg.base + (km * catCfg.km);

  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDist) txtDist.textContent = `${km} km • ${rotaAtual.duracaoMin} min`;
  if (txtPreco) txtPreco.textContent = `R$ ${valorBase.toFixed(2).replace('.', ',')}`;
}

async function submeterPedido() {
  if (!rotaAtual || !coordsDestino) {
    alert('Toque no mapa para indicar o destino da viagem.');
    return;
  }

  const token = localStorage.getItem('huby_token');
  const clienteId = localStorage.getItem('huby_user_id');
  const novoId = 'ped_' + Date.now().toString(36);

  const catCfg = CATEGORIAS[categoriaSelecionada]?.tipos?.[0] || { base: 7.0, km: 2.2, nome: 'HUBy Pop' };
  const valorTotal = (catCfg.base + (rotaAtual.distanciaKm * catCfg.km)).toFixed(2);

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    tipo: categoriaSelecionada,
    subTipoId: catCfg.nome ? catCfg.nome.toLowerCase().replace(/\s+/g, '_') : 'huby_pop',
    subTipoLabel: catCfg.nome || 'HUBy Corrida',
    origem: 'Local de Partida',
    destino: `Lat: ${coordsDestino[0].toFixed(4)}, Lng: ${coordsDestino[1].toFixed(4)}`,
    coordsOrigem: hubyMapa.coordsOrigem,
    coordsDestino: coordsDestino,
    distanciaKm: rotaAtual.distanciaKm,
    duracaoMin: rotaAtual.duracaoMin,
    valorTotal: valorTotal,
    metodoPgto: 'pix_app'
  };

  const btn = document.getElementById('btnPedirHuby');

  try {
    btn.disabled = true;
    btn.textContent = 'A solicitar condutor...';

    const resp = await fetch(`${API_URL}/api/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error('Falha ao registar pedido na base de dados.');

    pedidoAtivoId = novoId;
    mostrarAguardandoMotorista();
    iniciarPollingStatus();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    atualizarBotaoChamar();
  }
}

function mostrarAguardandoMotorista() {
  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const btn = document.getElementById('btnPedirHuby');

  if (blocoResumo) blocoResumo.style.display = 'none';
  if (cardStatus) cardStatus.style.display = 'block';

  document.getElementById('statusTitulo').textContent = 'Radar Ativo: Procurando motorista...';
  document.getElementById('statusDescricao').textContent = 'O seu pedido foi enviado para os parceiros próximos.';

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Cancelar Chamada';
    btn.style.background = '#ef4444';
  }
}

function iniciarPollingStatus() {
  if (intervalPolling) clearInterval(intervalPolling);

  intervalPolling = setInterval(async () => {
    if (!pedidoAtivoId) return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/status`);
      if (!resp.ok) return;

      const pedido = await resp.json();

      if (pedido.status === 'aceito') {
        document.getElementById('statusTitulo').textContent = '✅ Condutor a caminho!';
        document.getElementById('statusDescricao').innerHTML = `
          <strong>Motorista:</strong> ${pedido.motorista_nome || 'Parceiro HUBy'}<br>
          <strong>Veículo:</strong> ${pedido.motorista_veiculo || ''} (${pedido.motorista_placa || ''})<br>
          <strong>Contato:</strong> ${pedido.motorista_telefone || 'Disponível no app'}
        `;
        const btn = document.getElementById('btnPedirHuby');
        if (btn) btn.style.display = 'none';
      } else if (pedido.status === 'concluido') {
        clearInterval(intervalPolling);
        corridaParaAvaliarId = pedidoAtivoId;
        resetarPainelCliente();

        // Abre modal de avaliação por estrelas
        const modal = document.getElementById('modalAvaliacao');
        if (modal) {
          modal.style.display = 'flex';
        } else {
          alert('Viagem concluída com sucesso!');
        }
      } else if (pedido.status === 'cancelado') {
        clearInterval(intervalPolling);
        alert('A corrida foi cancelada.');
        resetarPainelCliente();
      }
    } catch (e) {
      console.warn('Polling status:', e);
    }
  }, 3000);
}

async function enviarAvaliacaoCorrida() {
  if (!corridaParaAvaliarId) return;

  const token = localStorage.getItem('huby_token');
  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  const comentario = comentarioEl ? comentarioEl.value : '';
  const btn = document.getElementById('btnEnviarAvaliacao');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    const resp = await fetch(`${API_URL}/api/pedidos/${corridaParaAvaliarId}/avaliar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ nota: notaSelecionada, comentario })
    });

    if (!resp.ok) throw new Error('Não foi possível registrar a avaliação.');

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

async function cancelarBusca() {
  if (pedidoAtivoId) {
    const token = localStorage.getItem('huby_token');
    try {
      await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/cancelar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ motivo: 'Cancelado pelo passageiro' })
      });
    } catch (err) {
      console.warn('Erro ao cancelar pedido no backend:', err);
    }
  }

  if (intervalPolling) clearInterval(intervalPolling);
  resetarPainelCliente();
}

function resetarPainelCliente() {
  pedidoAtivoId = null;
  rotaAtual = null;
  coordsDestino = null;

  if (hubyMapa && hubyMapa.rotaLayer && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.rotaLayer);
    hubyMapa.rotaLayer = null;
  }
  if (hubyMapa && hubyMapa.markerDestino && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.markerDestino);
    hubyMapa.markerDestino = null;
  }

  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const btn = document.getElementById('btnPedirHuby');

  if (cardStatus) cardStatus.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'flex';

  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDestino) txtDestino.textContent = 'Aguardando seleção...';
  if (txtDist) txtDist.textContent = 'Toque no mapa para o destino';
  if (txtPreco) txtPreco.textContent = 'R$ 10,00';

  if (btn) {
    btn.disabled = false;
    btn.style.display = 'block';
    btn.style.background = '';
    atualizarBotaoChamar();
  }
}

async function carregarEExibirHistorico() {
  const token = localStorage.getItem('huby_token');
  if (!token) {
    alert('Inicie sessão para ver o seu histórico.');
    return;
  }

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error('Não foi possível obter o histórico.');

    const viagens = await resp.json();
    if (viagens.length === 0) {
      alert('Ainda não realizou nenhuma viagem com a HUBy.');
      return;
    }

    const resumoTexto = viagens.slice(0, 5).map(v => 
      `• ${v.sub_tipo_label || 'Corrida'} (${v.distancia_km} km) - R$ ${Number(v.valor_total).toFixed(2)} [${v.status}]`
    ).join('\n');

    alert(`Suas últimas viagens:\n\n${resumoTexto}`);
  } catch (err) {
    alert(err.message);
  }
}