// js/cliente/cliente-pedidos.js - Gestão de Pedidos, Carteira Pré-Paga e Radar HUBy Sincronizado
import { API_URL, calcularPreco, sincronizarTarifasServidor, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { configurarChatCliente, fecharChatCliente } from './cliente-chat.js';
import { notificar } from '../util/alertas-huby.js';

export function atualizarBotaoChamar(resumo = null) {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn || estadoCliente.pedidoAtivoId) return;

  const labels = {
    carro: 'Confirmar HUBy Carro',
    moto: 'Confirmar HUBy Moto',
    entrega: 'Confirmar HUBy Flash'
  };
  const spanText = btn.querySelector('.btn-text');
  if (spanText) {
    spanText.textContent = labels[estadoCliente.categoriaSelecionada] || 'Confirmar HUBy';
  } else {
    btn.textContent = labels[estadoCliente.categoriaSelecionada] || 'Confirmar HUBy';
  }
}

export function atualizarResumoValores() {
  const lblPreco = document.getElementById('txtPrecoEstimado');
  const lblDistancia = document.getElementById('txtDistanciaEstimada');

  if (!estadoCliente.coordsDestino || !estadoCliente.rotaAtual) {
    if (lblPreco) lblPreco.textContent = '--';
    if (lblDistancia) lblDistancia.textContent = '-- km';
    estadoCliente.precoFinalCalculado = null;
    return;
  }

  let distanciaKm = 0;
  if (estadoCliente.rotaAtual.distanciaKm) {
    distanciaKm = Number(estadoCliente.rotaAtual.distanciaKm);
  } else if (estadoCliente.distanciaTotalComParadas) {
    distanciaKm = Number(estadoCliente.distanciaTotalComParadas);
  }

  const categoria = estadoCliente.categoriaSelecionada || 'carro';
  const calc = calcularPreco(categoria, Math.max(0.2, distanciaKm));
  let precoFinal = calc.valorTotal;

  // Adicional por paradas intermediárias (R$ 2,50 cada)
  const qtdParadas = estadoCliente.paradasIntermediarias?.length || 0;
  precoFinal = Number((precoFinal + (qtdParadas * 2.50)).toFixed(2));

  estadoCliente.precoFinalCalculado = precoFinal;
  estadoCliente.rotaAtual.preco = precoFinal;

  if (lblPreco) {
    lblPreco.textContent = `R$ ${precoFinal.toFixed(2).replace('.', ',')}`;
  }
  if (lblDistancia) {
    lblDistancia.textContent = distanciaKm > 0 ? `${distanciaKm.toFixed(1)} km` : '-- km';
  }
}

export async function submeterPedido() {
  const token = localStorage.getItem('huby_token');
  
  if (!token || token === 'null' || token === 'undefined') {
    notificar('Sua sessão expirou. Faça login para chamar.', 'alerta');
    window.location.replace('./login.html?perfil=cliente');
    return;
  }

  if (!estadoCliente.rotaAtual || !estadoCliente.coordsDestino) {
    notificar('Por favor, indique o destino da viagem no mapa ou pesquise.', 'alerta');
    return;
  }

  if (estadoCliente.categoriaSelecionada === 'entrega') {
    const recebedorVal = document.getElementById('inputRecebedor')?.value.trim();
    if (!recebedorVal) {
      notificar('Informe quem irá receber a encomenda (Nome e Telefone).', 'alerta');
      return;
    }
  }

  // Garante tarifas atualizadas no momento exato do pedido
  await sincronizarTarifasServidor();
  atualizarResumoValores();

  const clienteId = localStorage.getItem('huby_user_id');
  const novoId = 'ped_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  const kmTotal = Number(estadoCliente.distanciaTotalComParadas || estadoCliente.rotaAtual.distanciaKm || 1.0);
  const duracaoTotal = Number(estadoCliente.duracaoTotalComParadas || estadoCliente.rotaAtual.duracaoMin || 5);
  const precoInfo = calcularPreco(estadoCliente.categoriaSelecionada || 'carro', kmTotal);
  const qtdParadas = estadoCliente.paradasIntermediarias?.length || 0;
  const precoDefinitivo = Number((precoInfo.valorTotal + (qtdParadas * 2.50)).toFixed(2));
  const cupomCodigo = document.getElementById('inputCupomDesconto')?.value.trim().toUpperCase() || null;

  const coordsOrigemArr = estadoCliente.hubyMapa?.coordsOrigem || [-8.3582, -42.2476];
  const coordsDestinoArr = estadoCliente.coordsDestino;

  const latOrigNum = parseFloat(coordsOrigemArr[0]);
  const lngOrigNum = parseFloat(coordsOrigemArr[1]);
  const latDestNum = parseFloat(coordsDestinoArr[0]);
  const lngDestNum = parseFloat(coordsDestinoArr[1]);

  let metodoPgto = 'dinheiro';
  const metodoRapido = document.querySelector('.opcao-pagamento-rapido.ativa')?.getAttribute('data-metodo');
  if (metodoRapido) {
    metodoPgto = metodoRapido;
  }

  const txtDestino = document.getElementById('txtDestinoSelecionado');
  let nomeDestino = txtDestino ? txtDestino.textContent : `Destino (${latDestNum.toFixed(4)}, ${lngDestNum.toFixed(4)})`;

  if (estadoCliente.categoriaSelecionada === 'entrega') {
    const recebedor = document.getElementById('inputRecebedor')?.value || 'Não informado';
    const tipoItemEl = document.getElementById('selectTipoItem');
    const tipoItem = tipoItemEl && tipoItemEl.value !== "" ? tipoItemEl.options[tipoItemEl.selectedIndex].text : 'Encomenda';
    nomeDestino += ` | 📦 Recebedor: ${recebedor} | 🏷️ ${tipoItem}`;
  }

  const notaMotorista = document.getElementById('txtNotaMotoristaBadge')?.textContent || '';

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    cliente_id: clienteId || null,
    tipo: estadoCliente.categoriaSelecionada || 'carro',
    sub_tipo_id: estadoCliente.categoriaSelecionada || 'carro',
    sub_tipo_label: precoInfo.categoria || 'HUBy Carro',
    origem_endereco: `Partida (${latOrigNum.toFixed(4)}, ${lngOrigNum.toFixed(4)})`,
    destino_endereco: nomeDestino,
    origem: `Partida (${latOrigNum.toFixed(4)}, ${lngOrigNum.toFixed(4)})`,
    destino: nomeDestino,
    origem_lat: latOrigNum,
    origem_lng: lngOrigNum,
    destino_lat: latDestNum,
    destino_lng: lngDestNum,
    coordsOrigem: [latOrigNum, lngOrigNum],
    coordsDestino: [latDestNum, lngDestNum],
    distancia_km: kmTotal,
    duracao_min: duracaoTotal,
    distanciaKm: kmTotal,
    duracaoMin: duracaoTotal,
    valor_total: precoDefinitivo,
    valorTotal: precoDefinitivo,
    metodo_pagamento: metodoPgto,
    metodoPgto: metodoPgto,
    cupomCodigo: cupomCodigo,
    observacao: notaMotorista,
    paradas: estadoCliente.paradasIntermediarias || []
  };

  const btn = document.getElementById('btnPedirHuby');

  try {
    if (btn) {
      btn.disabled = true;
      const span = btn.querySelector('.btn-text');
      if (span) span.textContent = 'A solicitar condutor...';
      else btn.textContent = 'A solicitar condutor...';
    }

    const resp = await fetch(`${API_URL}/api/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const dadosResposta = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      if (resp.status === 401) {
        localStorage.removeItem('huby_token');
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      throw new Error(dadosResposta.erro || 'Falha ao registrar pedido.');
    }

    if (dadosResposta.desconto > 0) {
      notificar(`🎉 Cupom aplicado! Desconto de R$ ${Number(dadosResposta.desconto).toFixed(2).replace('.', ',')}`, 'sucesso');
    }

    estadoCliente.pedidoAtivoId = novoId;
    localStorage.setItem('huby_pedido_ativo_id', novoId);

    mostrarAguardandoMotorista();
    conectarSocketCliente(novoId);
    iniciarPollingStatus();

  } catch (err) {
    notificar(err.message, 'erro');
    if (err.message.includes('Sessão expirada')) {
      window.location.replace('./login.html?perfil=cliente');
      return;
    }
    if (btn) {
      btn.disabled = false;
      atualizarBotaoChamar();
    }
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

  const tit = document.getElementById('statusTitulo');
  const desc = document.getElementById('statusDescricao');
  if (tit) tit.textContent = 'Radar Ativo: Procurando motorista...';
  if (desc) desc.textContent = 'O seu pedido foi enviado para os parceiros próximos.';

  if (btn) {
    btn.disabled = false;
    const spanText = btn.querySelector('.btn-text');
    if (spanText) spanText.textContent = 'Cancelar Chamada';
    else btn.textContent = 'Cancelar Chamada';
    btn.style.background = '#ef4444';
  }
}

function conectarSocketCliente(pedidoId) {
  const token = localStorage.getItem('huby_token');
  const socket = window.io ? window.io(API_URL, {
    auth: { token: token || '' }
  }) : null;

  if (!socket) return;

  socket.on('corrida_aceita', (data) => {
    if (String(data.pedidoId) === String(pedidoId) || String(data.pedidoId) === String(estadoCliente.pedidoAtivoId)) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      atualizarInterfaceMotoristaAceitou({
        id: data.pedidoId,
        status: 'a_caminho',
        motorista_nome: data.motorista?.nome || 'Motorista Parceiro',
        motorista_veiculo: data.motorista?.veiculo || 'Veículo',
        motorista_placa: data.motorista?.placa || 'HUBy',
        veiculo_cor: data.motorista?.cor || 'Padrão',
        motorista_foto: data.motorista?.foto,
        motorista_avaliacao: data.motorista?.avaliacao,
        motorista_telefone: data.motorista?.telefone
      });
    }
  });

  socket.on('passageiro_a_bordo', (data) => {
    if (String(data.pedidoId) === String(pedidoId) || String(data.pedidoId) === String(estadoCliente.pedidoAtivoId)) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      const txtStatus = document.querySelector('#boxCronometroChegada div:first-child');
      if (txtStatus) txtStatus.textContent = '🚀 Viagem em andamento';
      const txtMin = document.getElementById('txtMinutosChegada');
      if (txtMin) txtMin.textContent = 'Rumo ao destino';
    }
  });

  socket.on('corrida_finalizada', (data) => {
    if (String(data.pedidoId) === String(pedidoId) || String(data.pedidoId) === String(estadoCliente.pedidoAtivoId)) {
      if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      estadoCliente.corridaParaAvaliarId = pedidoId;
      resetarPainelCliente();
      const modal = document.getElementById('modalAvaliacao');
      if (modal) modal.style.display = 'flex';
    }
  });
}

export function iniciarPollingStatus() {
  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  const token = localStorage.getItem('huby_token');

  estadoCliente.intervalPolling = setInterval(async () => {
    if (!estadoCliente.pedidoAtivoId) return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${estadoCliente.pedidoAtivoId}/status`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!resp.ok) return;

      const pedido = await resp.json();

      if (pedido.status === 'a_caminho' || pedido.status === 'em_andamento' || pedido.status === 'aceito' || pedido.status === 'em_viagem') {
        if (!estadoCliente.motoristaAceitouTocado) {
          if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
          estadoCliente.motoristaAceitouTocado = true;
        }

        atualizarInterfaceMotoristaAceitou(pedido);

        if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map && typeof L !== 'undefined' && !estadoCliente.markerMotoristaAaminho) {
          const iconeCondutor = L.divIcon({
            className: 'huby-pin-motorista',
            html: '<div style="width:28px;height:28px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(16,185,129,0.9);font-size:14px;">🚘</div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });
          estadoCliente.markerMotoristaAaminho = L.marker(estadoCliente.hubyMapa.coordsOrigem, { icon: iconeCondutor }).addTo(estadoCliente.hubyMapa.map);
        }

      } else if (pedido.status === 'concluido') {
        clearInterval(estadoCliente.intervalPolling);
        if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
        
        estadoCliente.corridaParaAvaliarId = estadoCliente.pedidoAtivoId;
        resetarPainelCliente();

        const modal = document.getElementById('modalAvaliacao');
        if (modal) {
          modal.style.display = 'flex';
        } else {
          notificar('Viagem concluída com sucesso!', 'sucesso');
        }
      } else if (pedido.status === 'cancelado') {
        clearInterval(estadoCliente.intervalPolling);
        notificar('A corrida foi cancelada.', 'alerta');
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
  const modelo = pedido.motorista_veiculo || 'Veículo';
  const cor = pedido.veiculo_cor ? `Cor: ${pedido.veiculo_cor}` : 'Cor: Padrão';
  const placa = (pedido.motorista_placa || 'HUBy').toUpperCase();
  const telefone = pedido.motorista_telefone || '';

  const tituloStatus = (pedido.status === 'em_viagem') 
    ? '🚀 Em viagem ao destino' 
    : '🚘 Motorista a caminho';

  painelMotorista.innerHTML = `
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(16, 185, 129, 0.12); border: 1.5px solid rgba(16, 185, 129, 0.4); padding: 12px; border-radius: 14px;">
      <div style="color: #10B981; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
        ${tituloStatus}
      </div>
      <div style="color: #FFF; font-size: 20px; font-weight: 900; margin-top: 3px;">
        Chega em <span id="txtMinutosChegada" style="color: #38BDF8;">${estadoCliente.tempoEstimado || 4} min</span>
      </div>
    </div>

    <div class="driver-card-accepted" style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--border-dark); border-radius: 16px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
      <div class="driver-card-top" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${foto}" alt="${nome}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--emerald);">
          <div>
            <h4 style="margin: 0; color: #FFF; font-size: 15px;">${nome}</h4>
            <div style="color: #F59E0B; font-weight: 800; font-size: 12px; margin-top: 2px;">
              ⭐ ${nota} <span style="color: var(--text-sec); font-weight: 500;">• ${totalViagens} viagens</span>
            </div>
          </div>
        </div>

        <div style="text-align: right;">
          <strong style="color: #FFF; font-size: 13px; display: block;">${modelo}</strong>
          <small style="color: var(--text-sec); font-size: 11px; display: block; margin-bottom: 3px;">${cor}</small>
          <div style="display: inline-block; border: 1.5px solid #FFF; border-radius: 4px; background: #FFF; color: #000; font-family: monospace; font-size: 11px; font-weight: 900; padding: 1px 6px;">
            <span style="color:#003399;">BR</span> ${placa}
          </div>
        </div>
      </div>

      <div class="driver-card-actions" style="display: grid; grid-template-columns: ${telefone ? '1fr 1.5fr' : '1fr'}; gap: 8px; margin-top: 10px;">
        ${telefone ? `
          <a href="tel:${telefone}" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-dark); color: #FFF; font-weight: 800; padding: 10px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
            📞 Ligar
          </a>
        ` : ''}
        <button type="button" id="btnAbrirChatClienteCard" 
          style="background: rgba(56,189,248,0.18); border: 1px solid #38BDF8; color: #38BDF8; font-weight: 800; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;">
          💬 Mensagem
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnAbrirChatClienteCard')?.addEventListener('click', () => {
    const modalChat = document.getElementById('modalChatCorrida');
    if (modalChat) modalChat.style.display = 'flex';
  });

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
  estadoCliente.motoristaAceitouTocado = false;
  localStorage.removeItem('huby_pedido_ativo_id');

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
  if (txtPreco) txtPreco.textContent = '--';

  if (btn) {
    btn.disabled = false;
    btn.style.display = 'block';
    btn.style.background = '';
    atualizarBotaoChamar();
  }
  
  fecharChatCliente();
}