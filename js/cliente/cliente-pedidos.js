// js/cliente/cliente-pedidos.js
import { API_URL, calcularPreco, MULTIPLICADOR_PICO } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { configurarChatCliente, fecharChatCliente } from './cliente-chat.js';

export function atualizarBotaoChamar() {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn || estadoCliente.pedidoAtivoId) return;

  const labels = {
    carro: 'Chamar HUBy Carro',
    moto: 'Chamar HUBy Moto',
    entrega: 'Solicitar Entrega'
  };
  btn.textContent = labels[estadoCliente.categoriaSelecionada] || 'Chamar HUBy';
}

export function atualizarResumoValores() {
  if (!estadoCliente.rotaAtual) return;

  const km = estadoCliente.rotaAtual.distanciaKm;
  const precoCalculado = calcularPreco(estadoCliente.categoriaSelecionada, km);

  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDist) {
    const dinamicaInfo = MULTIPLICADOR_PICO > 1.0 ? ` • ⚡ Dinâmica ${MULTIPLICADOR_PICO}x` : '';
    txtDist.textContent = `${km} km • ⏱️ ${estadoCliente.rotaAtual.duracaoMin} min${dinamicaInfo}`;
  }
  if (txtPreco) {
    txtPreco.textContent = precoCalculado.formatado;
  }
}

export async function submeterPedido() {
  if (!estadoCliente.rotaAtual || !estadoCliente.coordsDestino) {
    alert('Por favor, indique o destino da viagem.');
    return;
  }

  if (estadoCliente.categoriaSelecionada === 'entrega') {
    const recebedorVal = document.getElementById('inputRecebedor')?.value.trim();
    if (!recebedorVal) {
      alert('Para a segurança da sua entrega, informe quem irá receber a encomenda (Nome e Telefone).');
      return;
    }
  }

  const token = localStorage.getItem('huby_token');
  const clienteId = localStorage.getItem('huby_user_id');
  const novoId = 'ped_' + Date.now().toString(36);

  const precoInfo = calcularPreco(estadoCliente.categoriaSelecionada, estadoCliente.rotaAtual.distanciaKm);
  const cupomCodigo = document.getElementById('inputCupomDesconto')?.value.trim().toUpperCase() || null;

  const latOrig = estadoCliente.hubyMapa?.coordsOrigem ? estadoCliente.hubyMapa.coordsOrigem[0].toFixed(4) : '-8.3580';
  const lngOrig = estadoCliente.hubyMapa?.coordsOrigem ? estadoCliente.hubyMapa.coordsOrigem[1].toFixed(4) : '-42.2460';
  
  const txtDestino = document.getElementById('txtDestinoSelecionado');
  let nomeDestino = txtDestino ? txtDestino.textContent : `Destino (${estadoCliente.coordsDestino[0].toFixed(4)}, ${estadoCliente.coordsDestino[1].toFixed(4)})`;

  if (estadoCliente.categoriaSelecionada === 'entrega') {
    const recebedor = document.getElementById('inputRecebedor')?.value || 'Não informado';
    const tipoItemEl = document.getElementById('selectTipoItem');
    const tipoItem = tipoItemEl && tipoItemEl.value !== "" ? tipoItemEl.options[tipoItemEl.selectedIndex].text : 'Encomenda genérica';
    nomeDestino += ` | 📦 Recebedor: ${recebedor} | 🏷️ ${tipoItem}`;
  }

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    tipo: estadoCliente.categoriaSelecionada,
    subTipoId: estadoCliente.categoriaSelecionada,
    subTipoLabel: precoInfo.categoria,
    origem: `Partida (${latOrig}, ${lngOrig})`,
    destino: nomeDestino,
    coordsOrigem: estadoCliente.hubyMapa.coordsOrigem,
    coordsDestino: estadoCliente.coordsDestino,
    distanciaKm: estadoCliente.rotaAtual.distanciaKm,
    duracaoMin: estadoCliente.rotaAtual.duracaoMin,
    valorTotal: precoInfo.valorTotal,
    metodoPgto: 'pix_app',
    cupomCodigo
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
    const dadosResposta = await resp.json();

    if (dadosResposta.desconto > 0) {
      alert(`🎉 Cupom aplicado! Desconto de R$ ${Number(dadosResposta.desconto).toFixed(2).replace('.', ',')}`);
    }

    estadoCliente.pedidoAtivoId = novoId;
    mostrarAguardandoMotorista();
    iniciarPollingStatus();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    atualizarBotaoChamar();
  }
}

export function mostrarAguardandoMotorista() {
  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
  const btn = document.getElementById('btnPedirHuby');

  if (blocoResumo) blocoResumo.style.display = 'none';
  if (blocoEntrega) blocoEntrega.style.display = 'none';
  if (cardStatus) cardStatus.style.display = 'block';

  document.getElementById('statusTitulo').textContent = 'Radar Ativo: Procurando motorista...';
  document.getElementById('statusDescricao').textContent = 'O seu pedido foi enviado para os parceiros próximos.';

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Cancelar Chamada';
    btn.style.background = '#ef4444';
  }
}

export async function acionarSosCliente() {
  if (!estadoCliente.pedidoAtivoId) {
    alert('O alerta SOS só pode ser acionado durante uma viagem ativa.');
    return;
  }

  if (!confirm('🚨 ATENÇÃO: Deseja acionar a emergência SOS?\nA central de monitoramento e os contatos de suporte serão alertados com sua localização.')) {
    return;
  }

  const token = localStorage.getItem('huby_token');
  const lat = estadoCliente.hubyMapa?.coordsOrigem ? estadoCliente.hubyMapa.coordsOrigem[0] : null;
  const lng = estadoCliente.hubyMapa?.coordsOrigem ? estadoCliente.hubyMapa.coordsOrigem[1] : null;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${estadoCliente.pedidoAtivoId}/sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ lat, lng, relato: 'Emergência acionada pelo passageiro no aplicativo.' })
    });

    if (res.ok) {
      alert('🚨 ALERTA SOS REGISTRADO!\nA equipe da HUBy foi alertada e o suporte está ciente da sua localização.');
    }
  } catch (err) {
    alert('Erro ao transmitir SOS. Ligue imediatamente para a polícia (190).');
  }
}

export function iniciarPollingStatus() {
  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);

  estadoCliente.intervalPolling = setInterval(async () => {
    if (!estadoCliente.pedidoAtivoId) return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${estadoCliente.pedidoAtivoId}/status`);
      if (!resp.ok) return;

      const pedido = await resp.json();

      if (pedido.status === 'aceito' || pedido.status === 'em_viagem') {
        atualizarInterfaceMotoristaAceitou(pedido);

        if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map && typeof L !== 'undefined' && !estadoCliente.markerMotoristaAaminho) {
          const iconeCondutor = L.divIcon({
            className: 'huby-pin-motorista',
            html: '<div style="width:24px;height:24px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(16,185,129,0.8);font-size:12px;">🚘</div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          estadoCliente.markerMotoristaAaminho = L.marker(estadoCliente.hubyMapa.coordsOrigem, { icon: iconeCondutor }).addTo(estadoCliente.hubyMapa.map);
        }

      } else if (pedido.status === 'concluido') {
        clearInterval(estadoCliente.intervalPolling);
        estadoCliente.corridaParaAvaliarId = estadoCliente.pedidoAtivoId;
        resetarPainelCliente();

        const modal = document.getElementById('modalAvaliacao');
        if (modal) {
          modal.style.display = 'flex';
        } else {
          alert('Viagem concluída com sucesso!');
        }
      } else if (pedido.status === 'cancelado') {
        clearInterval(estadoCliente.intervalPolling);
        alert('A corrida foi cancelada.');
        resetarPainelCliente();
      }
    } catch (e) {
      console.warn('Polling status:', e);
    }
  }, 3000);
}

export function atualizarInterfaceMotoristaAceitou(pedido) {
  const sliderCategorias = document.getElementById('sliderCategorias');
  const blocoResumo = document.getElementById('blocoResumo');
  const cardStatusViagem = document.getElementById('cardStatusViagem');
  const btnPedirHuby = document.getElementById('btnPedirHuby');
  
  if (sliderCategorias) sliderCategorias.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'none';
  if (cardStatusViagem) cardStatusViagem.style.display = 'none';
  if (btnPedirHuby) btnPedirHuby.style.display = 'none';

  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  if (!painelMotorista) return;

  painelMotorista.style.display = 'block';

  const foto = pedido.motorista_foto || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80';
  const nome = pedido.motorista_nome || 'Motorista Parceiro';
  const nota = Number(pedido.motorista_avaliacao || 5.0).toFixed(1);
  const totalViagens = pedido.motorista_corridas || 0;
  const modelo = pedido.motorista_veiculo || 'Carro HUBy';
  const cor = pedido.veiculo_cor ? `Cor: ${pedido.veiculo_cor}` : 'Cor padrão';
  const placa = (pedido.motorista_placa || 'HUB-0000').toUpperCase();
  const telefone = pedido.motorista_telefone || '';

  painelMotorista.innerHTML = `
    <!-- CRONÔMETRO DE CHEGADA -->
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px; border-radius: 12px;">
      <div style="color: #10B981; font-size: 13px; font-weight: 800; text-transform: uppercase;">
        ${pedido.status === 'aceito' ? '🚘 Motorista a caminho' : '🏁 Viagem em andamento'}
      </div>
      <div style="color: #FFF; font-size: 20px; font-weight: 900; margin-top: 3px;">
        Chega em <span id="txtMinutosChegada" style="color: #38BDF8;">${estadoCliente.tempoEstimado} min</span>
      </div>
    </div>

    <!-- CARD DO MOTORISTA -->
    <div class="driver-card-accepted">
      <!-- Topo: Foto, Nome e Reputação -->
      <div class="driver-card-top">
        <div class="driver-avatar-container">
          <img src="${foto}" alt="${nome}" class="driver-avatar-img">
          <span class="badge-verified-driver">✓</span>
        </div>
        <div class="driver-header-meta">
          <h4>${nome}</h4>
          <div class="driver-rating-row">
            <span style="color: #F59E0B; font-weight: 800;">⭐ ${nota}</span>
            <span>•</span>
            <span>${totalViagens} viagens</span>
          </div>
        </div>
      </div>

      <!-- Veículo e Placa Mercosul Estilizada -->
      <div class="driver-vehicle-box">
        <div class="vehicle-desc">
          <strong>${modelo}</strong>
          <small>${cor}</small>
        </div>
        <div class="mercosul-plate-passenger">
          <div class="mercosul-plate-header"><span>BRASIL</span> <span>🇧🇷</span></div>
          <div class="mercosul-plate-body">${placa}</div>
        </div>
      </div>

      <!-- Ações Rápidas -->
      <div class="driver-card-actions">
        ${telefone ? `
          <a href="tel:${telefone}" class="btn-contact-call">
            📞 Ligar
          </a>
        ` : ''}
        <button type="button" id="btnAbrirChatClienteCard" class="btn-contact-chat">
          💬 Mensagem
        </button>
      </div>
    </div>
  `;

  // Gerenciamento do cronômetro regressivo
  if (!estadoCliente.cronometroChegada) {
    estadoCliente.cronometroChegada = setInterval(() => {
      estadoCliente.tempoEstimado--;
      const txtMinutos = document.getElementById('txtMinutosChegada');
      if (estadoCliente.tempoEstimado > 0) {
        if (txtMinutos) txtMinutos.textContent = `${estadoCliente.tempoEstimado} min`;
      } else {
        if (txtMinutos) txtMinutos.textContent = `A chegar!`;
        clearInterval(estadoCliente.cronometroChegada);
        estadoCliente.cronometroChegada = null;
      }
    }, 60000);
  }

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'flex';

  configurarChatCliente(pedido.id);
}

export async function cancelarBusca() {
  if (estadoCliente.pedidoAtivoId) {
    const token = localStorage.getItem('huby_token');
    try {
      await fetch(`${API_URL}/api/pedidos/${estadoCliente.pedidoAtivoId}/cancelar`, {
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

  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  resetarPainelCliente();
}

export function resetarPainelCliente() {
  estadoCliente.pedidoAtivoId = null;
  estadoCliente.rotaAtual = null;
  estadoCliente.coordsDestino = null;

  if (estadoCliente.cronometroChegada) {
    clearInterval(estadoCliente.cronometroChegada);
    estadoCliente.cronometroChegada = null;
  }
  const divTempo = document.getElementById('boxCronometroChegada');
  if (divTempo) divTempo.remove();

  if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.rotaLayer && estadoCliente.hubyMapa.map) {
    estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.rotaLayer);
    estadoCliente.hubyMapa.rotaLayer = null;
  }
  if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.markerDestino && estadoCliente.hubyMapa.map) {
    estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.markerDestino);
    estadoCliente.hubyMapa.markerDestino = null;
  }
  if (estadoCliente.markerMotoristaAaminho && estadoCliente.hubyMapa && estadoCliente.hubyMapa.map) {
    estadoCliente.hubyMapa.map.removeLayer(estadoCliente.markerMotoristaAaminho);
    estadoCliente.markerMotoristaAaminho = null;
  }

  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
  const btn = document.getElementById('btnPedirHuby');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  
  if (inputPesquisa) inputPesquisa.value = '';
  if (btnLimpar) btnLimpar.style.display = 'none';

  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  if (painelMotorista) {
    painelMotorista.style.display = 'none';
    painelMotorista.innerHTML = '';
  }

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'none';
  
  const sliderCategorias = document.getElementById('sliderCategorias');
  if (sliderCategorias) sliderCategorias.style.display = 'flex';

  if (cardStatus) cardStatus.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'flex';
  
  if (blocoEntrega) {
    blocoEntrega.style.display = (estadoCliente.categoriaSelecionada === 'entrega') ? 'block' : 'none';
  }

  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDestino) txtDestino.textContent = 'Toque no mapa para indicar o destino';
  if (txtDist) txtDist.textContent = '-- km';
  if (txtPreco) txtPreco.textContent = 'R$ 10,00';

  if (btn) {
    btn.disabled = false;
    btn.style.display = 'block';
    btn.style.background = '';
    atualizarBotaoChamar();
  }
  
  fecharChatCliente();
}