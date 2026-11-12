// js/motorista/motorista-corrida.js - Gestão de Corridas, Prévia Hands-Free e Liquidação Sincronizada HUBy
import { API_URL, sonsHUBy, calcularPreco, sincronizarTarifasServidor, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { tracarRotaRealRuas, limparRotasMapa } from './motorista-mapa.js';
import { iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';
import { carregarPerfil } from './motorista-perfil.js';
import { iniciarMonitoramentoDesvios, pararMonitoramentoDesvios } from './motorista-rotas.js';
import { notificar } from '../util/alertas-huby.js';

let processandoPagamento = false;

// Calcula o valor bruto e o repasse líquido do motorista usando a tarifa e taxa reais do banco
export function obterValoresSincronizadosPedido(dados = {}) {
  const distKm = parseFloat(dados.dist || dados.distancia_km || dados.distanciaKm || 0);
  const categoria = String(dados.categoria || dados.tipo || estado.categoriaVeiculo || 'carro').toLowerCase();

  let valorBruto = Number(dados.preco || dados.valor_total || dados.valorTotal || 0);

  // Se houver distância válida e o valor não estiver sincronizado ou for zero, calcula pela tabela oficial
  if (distKm > 0 && (!valorBruto || valorBruto <= 0)) {
    valorBruto = calcularPreco(categoria, distKm).valorTotal;
  }

  const taxaPct = Number(TAXA_PLATAFORMA_ATUAL ?? 15);
  const fatorMotorista = Math.max(0.1, (100 - taxaPct) / 100);
  const repasseNum = Number((valorBruto * fatorMotorista).toFixed(2));

  return {
    valorBruto,
    repasseNum,
    taxaPct,
    valorBrutoFmt: valorBruto.toFixed(2).replace('.', ','),
    repasseFmt: repasseNum.toFixed(2).replace('.', ',')
  };
}

// ============================================================================
// 1. PRÉ-VISUALIZAÇÃO DA ROTA ANTES DE ACEITAR (HANDS-FREE OU TOQUE)
// ============================================================================
export async function preVisualizarRotaPedido(dados) {
  await sincronizarTarifasServidor();
  estado.pedidoEmAnalise = dados;
  pararRadarChamadas();
  pararMonitoramentoDesvios();
  limparRotasMapa();

  const coordsOrigem = dados.coordsOrig || [estado.coords[0] + 0.003, estado.coords[1] + 0.003];
  const coordsDestino = dados.coordsDest || [estado.coords[0] + 0.009, estado.coords[1] + 0.009];

  if (estado.mapa) {
    estado.markerOrigem = L.marker(coordsOrigem, {
      icon: L.divIcon({ html: '<div style="font-size:24px;">🟢</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
    }).addTo(estado.mapa);

    estado.markerDestino = L.marker(coordsDestino, {
      icon: L.divIcon({ html: '<div style="font-size:24px;">🏁</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(coordsOrigem, coordsDestino, '#F59E0B');
  }

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { valorBrutoFmt, repasseFmt } = obterValoresSincronizadosPedido(dados);

  container.innerHTML = `
    <div id="modalPreviaRotaCorrida" style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--amber); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--amber); background: rgba(245,158,11,0.15); padding: 4px 10px; border-radius: 8px;">
          🔍 ROTA EM ANÁLISE
        </span>
        <div style="text-align: right;">
          <strong style="color: var(--emerald); font-size: 21px; font-weight: 900; display: block;">R$ ${repasseFmt}</strong>
          <small style="color: #94A3B8; font-size: 10px;">Total passageiro: R$ ${valorBrutoFmt}</small>
        </div>
      </div>

      <div style="font-size: 12px; color: #FFF; line-height: 1.4;">
        <div style="color: #94A3B8;">🟢 <strong>Buscar em:</strong> ${dados.origem}</div>
        <div style="margin-top: 3px;">📍 <strong>Destino:</strong> ${dados.destino}</div>
        <div style="font-size: 11px; color: var(--text-sec); margin-top: 4px;">
          📏 Distância: <strong id="lblPreviaDistKm">${dados.dist || '1.0'} km</strong> • ⏱️ ~<span id="lblPreviaDurMin">${dados.dur || 5}</span> min
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin-top: 4px;">
        <button type="button" id="btnCancelarPreviaRota"
          style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-dark); color: #FFF; font-weight: 700; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✕ Voltar
        </button>
        <button type="button" id="btnConfirmarAceiteViagem"
          style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✅ Aceitar Corrida
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnCancelarPreviaRota')?.addEventListener('click', () => {
    limparRotasMapa();
    pararMonitoramentoDesvios();
    estado.pedidoEmAnalise = null;
    iniciarRadarChamadas();
  });

  document.getElementById('btnConfirmarAceiteViagem')?.addEventListener('click', () => {
    aceitarCorrida(dados);
  });
}

export async function aceitarPedidoPrevia() {
  if (estado.pedidoEmAnalise) {
    await aceitarCorrida(estado.pedidoEmAnalise);
  }
}

// ============================================================================
// 2. ACEITAR CORRIDA E FLUXO A CAMINHO DO EMBARQUE
// ============================================================================
export async function aceitarCorrida(dados) {
  try {
    const res = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({
        motoristaId: estado.motoristaId || localStorage.getItem('huby_motorista_id'),
        motoristaNome: estado.motoristaNome || localStorage.getItem('huby_user_name') || 'Carol'
      })
    });

    const resJson = await res.json().catch(() => ({}));

    if (res.ok || resJson.sucesso) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      iniciarFaseBuscarPassageiro(dados);
    } else {
      notificar(resJson.erro || 'Esta corrida já não está disponível.', 'alerta');
      limparRotasMapa();
      pararMonitoramentoDesvios();
      estado.pedidoEmAnalise = null;
      iniciarRadarChamadas();
    }
  } catch (err) {
    iniciarFaseBuscarPassageiro(dados);
  }
}

async function iniciarFaseBuscarPassageiro(dados) {
  estado.pedidoAceitoAtual = dados;
  estado.pedidoAtivo = dados;
  estado.pedidoEmAnalise = null;
  estado.etapaCorridaAtual = 'a_caminho';
  pararRadarChamadas();

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  limparRotasMapa();
  const coordsOrigem = dados.coordsOrig || [estado.coords[0] + 0.003, estado.coords[1] + 0.003];

  if (estado.mapa) {
    estado.markerOrigem = L.marker(coordsOrigem, {
      icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">👤</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(estado.coords, coordsOrigem, '#38BDF8');
  }

  iniciarMonitoramentoDesvios(coordsOrigem);

  const urlWaze = `https://waze.com/ul?ll=${coordsOrigem[0]},${coordsOrigem[1]}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${coordsOrigem[0]},${coordsOrigem[1]}`;
  const { repasseFmt } = obterValoresSincronizadosPedido(dados);

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--blue); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
          🚗 A CAMINHO DO PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${repasseFmt}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🟢 <strong>Embarque:</strong> <span style="color: #94A3B8;">${dados.origem}</span>
        <div style="font-size: 11px; color: var(--text-sec); margin-top: 3px;">
          📏 ${dados.dist || '1.0'} km • ⏱️ ~${dados.dur || 5} min
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Waze (Embarque)
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Maps (Embarque)
        </a>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" id="btnChegueiLocalEmbarque"
          style="background: rgba(56,189,248,0.18); border: 1px solid #38BDF8; color: #38BDF8; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          📍 Cheguei no Local
        </button>
        <button type="button" id="btnIniciarCorridaAtiva"
          style="background: #38BDF8; border: none; color: #000; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          🚀 Iniciar Viagem
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnChegueiLocalEmbarque')?.addEventListener('click', async () => {
    try {
      await fetch(`${API_URL}/api/pedidos/${dados.id}/status`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ status: 'motorista_no_local' })
      });
    } catch (e) {}
    notificar('📍 Passageiro avisado que você chegou ao local de embarque!', 'sucesso');
  });

  document.getElementById('btnIniciarCorridaAtiva')?.addEventListener('click', () => confirmarEmbarqueEIrAoDestino(dados));
}

// ============================================================================
// 3. PASSAGEIRO A BORDO -> EM VIAGEM AO DESTINO
// ============================================================================
export async function confirmarEmbarqueEIrAoDestino(dados) {
  try {
    await fetch(`${API_URL}/api/pedidos/${dados.id}/embarque`, {
      method: 'PUT',
      headers: obterHeaders()
    });
  } catch (e) { }

  estado.etapaCorridaAtual = 'em_viagem';
  if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();

  limparRotasMapa();
  const coordsDestino = dados.coordsDest || [estado.coords[0] + 0.009, estado.coords[1] + 0.009];

  if (estado.mapa) {
    estado.markerDestino = L.marker(coordsDestino, {
      icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #10B981);">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(estado.coords, coordsDestino, '#10B981');
  }

  iniciarMonitoramentoDesvios(coordsDestino);

  const urlWaze = `https://waze.com/ul?ll=${coordsDestino[0]},${coordsDestino[1]}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${coordsDestino[0]},${coordsDestino[1]}`;
  const { repasseFmt } = obterValoresSincronizadosPedido(dados);

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 EM VIAGEM COM PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${repasseFmt}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🏁 <strong>Destino Final:</strong> <span style="color: #94A3B8;">${dados.destino}</span>
        <div style="font-size: 11px; color: var(--text-sec); margin-top: 3px;">
          📏 ${dados.dist || '1.0'} km • ⏱️ ~${dados.dur || 5} min
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Waze (Destino)
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Maps (Destino)
        </a>
      </div>

      <button type="button" id="btnConcluirCorrida"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
        🏁 Cheguei ao Destino / Finalizar
      </button>
    </div>
  `;

  document.getElementById('btnConcluirCorrida')?.addEventListener('click', () => abrirModalOpcoesPagamento(dados));
}

// ============================================================================
// 4. MODAL DE LIQUIDAÇÃO COM FILTRO DE PREFERÊNCIAS DO CONDUTOR
// ============================================================================
export function abrirModalOpcoesPagamento(dados) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const lblValor = document.getElementById('lblValorTotalPagamentoMotorista');

  const { valorBrutoFmt } = obterValoresSincronizadosPedido(dados);
  if (lblValor) {
    lblValor.textContent = `R$ ${valorBrutoFmt}`;
  }

  const btnDinheiro = document.getElementById('btnPagarDinheiro');
  const btnMaquininha = document.getElementById('btnPagarMaquininha');
  const btnPixMP = document.getElementById('btnPagarPixMP');
  const btnCancelar = document.getElementById('btnCancelarModalPagamento');

  if (btnDinheiro) btnDinheiro.style.display = estado.aceitaDinheiro ? 'flex' : 'none';
  if (btnMaquininha) btnMaquininha.style.display = estado.aceitaCartao ? 'flex' : 'none';
  if (btnPixMP) btnPixMP.style.display = estado.aceitaPix ? 'flex' : 'none';

  if (!estado.aceitaDinheiro && !estado.aceitaCartao && !estado.aceitaPix) {
    if (btnDinheiro) btnDinheiro.style.display = 'flex';
    if (btnMaquininha) btnMaquininha.style.display = 'flex';
    if (btnPixMP) btnPixMP.style.display = 'flex';
  }

  if (modal) modal.style.display = 'flex';

  if (btnDinheiro) btnDinheiro.onclick = () => processarLiquidacao(dados.id, 'dinheiro');
  if (btnMaquininha) btnMaquininha.onclick = () => processarLiquidacao(dados.id, 'cartao_maquininha');
  if (btnPixMP) btnPixMP.onclick = () => processarLiquidacao(dados.id, 'pix_mp');
  if (btnCancelar) {
    btnCancelar.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }
}

export async function processarLiquidacao(pedidoId, formaPagamento) {
  if (processandoPagamento) return;
  processandoPagamento = true;

  const modal = document.getElementById('modalEscolhaPagamentoMotorista');

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/finalizar-liquidacao`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ forma_pagamento: formaPagamento })
    });

    const textoResposta = await res.text();
    let data;
    try {
      data = JSON.parse(textoResposta);
    } catch (eJson) {
      throw new Error('O servidor respondeu com um formato inesperado. Tente novamente.');
    }

    if (!res.ok) {
      throw new Error(data.erro || `Falha na liquidação (Código HTTP: ${res.status})`);
    }

    if (modal) modal.style.display = 'none';

    if (formaPagamento === 'pix_mp') {
      exibirQrCodePixMotorista(data.pix);
    } else {
      const taxa = Number(TAXA_PLATAFORMA_ATUAL || 15);
      notificar(`✅ Corrida encerrada com sucesso! Taxa de ${taxa}% atualizada na carteira.`, 'sucesso');
      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      concluirLimpezaPosCorrida();
    }
  } catch (err) {
    notificar(err.message || 'Erro ao finalizar corrida.', 'erro');
  } finally {
    processandoPagamento = false;
  }
}

export function exibirQrCodePixMotorista(pix) {
  const modalPix = document.getElementById('modalExibicaoPixMotorista');
  const imgQr = document.getElementById('imgQrCodePixMotorista');
  const lblValor = document.getElementById('lblValorPixMotorista');
  const btnFechar = document.getElementById('btnFecharPixMotorista');

  if (lblValor) lblValor.textContent = `R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}`;
  if (imgQr) imgQr.src = `data:image/png;base64,${pix.qr_code_base64}`;

  if (modalPix) modalPix.style.display = 'flex';

  if (btnFechar) {
    btnFechar.onclick = () => {
      if (modalPix) modalPix.style.display = 'none';
      concluirLimpezaPosCorrida();
    };
  }
}

export function fecharModaisPagamento() {
  const modal1 = document.getElementById('modalEscolhaPagamentoMotorista');
  const modal2 = document.getElementById('modalExibicaoPixMotorista');
  if (modal1) modal1.style.display = 'none';
  if (modal2) modal2.style.display = 'none';
}

export function concluirLimpezaPosCorrida() {
  pararMonitoramentoDesvios();
  limparRotasMapa();
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';

  estado.pedidoAceitoAtual = null;
  estado.pedidoAtivo = null;
  estado.etapaCorridaAtual = 'a_caminho';
  carregarPerfil();
  iniciarRadarChamadas();
}