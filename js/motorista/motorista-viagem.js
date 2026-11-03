// js/motorista/motorista-viagem.js
import { API_URL, sonsHUBy } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { tracarRotaRealRuas, limparRotasMapa } from './motorista-mapa.js';
import { extrairDadosDoBotao, iniciarRadar } from './motorista-radar.js';
import { carregarPerfil } from './motorista-perfil.js';

export async function aceitarCorridaDefinitiva(btn, dadosCache) {
  const dados = dadosCache || extrairDadosDoBotao(btn);

  try {
    const r = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ 
        motoristaId: estado.motoristaId,
        motoristaNome: estado.motoristaNome 
      })
    });

    const resJson = await r.json().catch(() => ({}));

    if (r.ok || resJson.sucesso) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      iniciarFaseBuscarPassageiro(dados);
    } else {
      alert(resJson.erro || 'Esta corrida já não está disponível.');
      limparRotasMapa();
      estado.pedidoEmInspecao = null;
      iniciarRadar();
    }
  } catch (err) {
    iniciarFaseBuscarPassageiro(dados);
  }
}

export async function iniciarFaseBuscarPassageiro(dados) {
  estado.pedidoAtivo = dados;
  estado.pedidoAceitoAtual = dados;
  estado.pedidoEmInspecao = null;
  estado.faseViagem = 'buscar_passageiro';
  estado.etapaCorridaAtual = 'a_caminho';
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  limparRotasMapa();
  const coordsOrigem = [dados.origLat, dados.origLng];

  estado.markerOrigem = L.marker(coordsOrigem, {
    icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">👤</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
  }).addTo(estado.mapa);

  await tracarRotaRealRuas(estado.coords, coordsOrigem, '#38BDF8');

  const urlWaze = `https://waze.com/ul?ll=${dados.origLat},${dados.origLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.origLat},${dados.origLng}`;

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--blue); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
          🚗 A CAMINHO DO PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🟢 <strong>Embarque:</strong> <span style="color: #94A3B8;">${dados.origNome}</span>
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

      <button type="button" id="btnPassageiroEmbarcou"
        style="width: 100%; background: #38BDF8; border: none; color: #000; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
        📍 Cheguei / Passageiro a Bordo
      </button>
    </div>
  `;

  document.getElementById('btnPassageiroEmbarcou')?.addEventListener('click', () => confirmarEmbarqueEIrAoDestino(dados));
}

export async function confirmarEmbarqueEIrAoDestino(dados) {
  try {
    await fetch(`${API_URL}/api/pedidos/${dados.id}/embarque`, {
      method: 'PUT',
      headers: obterHeaders()
    });
  } catch (e) { }

  estado.faseViagem = 'a_caminho_destino';
  estado.etapaCorridaAtual = 'em_viagem';
  if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();

  limparRotasMapa();
  const coordsDestino = [dados.destLat, dados.destLng];

  estado.markerDestino = L.marker(coordsDestino, {
    icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #10B981);">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
  }).addTo(estado.mapa);

  await tracarRotaRealRuas(estado.coords, coordsDestino, '#10B981');

  const urlWaze = `https://waze.com/ul?ll=${dados.destLat},${dados.destLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.destLat},${dados.destLng}`;

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 EM VIAGEM COM PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🏁 <strong>Destino Final:</strong> <span style="color: #94A3B8;">${dados.destNome}</span>
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

      <button type="button" id="btnConcluirViagemAtiva"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
        🏁 Cheguei ao Destino / Finalizar
      </button>
    </div>
  `;

  document.getElementById('btnConcluirViagemAtiva')?.addEventListener('click', () => abrirModalOpcoesPagamento(dados));
}

export function abrirModalOpcoesPagamento(dados) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const lblValor = document.getElementById('lblValorTotalPagamentoMotorista');

  const valorBruto = dados.valorTotal > 0 ? dados.valorTotal : (parseFloat(String(dados.repasse).replace(',', '.')) / 0.85);

  if (lblValor) {
    lblValor.textContent = `R$ ${valorBruto.toFixed(2).replace('.', ',')}`;
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

  btnDinheiro.onclick = () => processarLiquidacao(dados.id, 'dinheiro');
  btnMaquininha.onclick = () => processarLiquidacao(dados.id, 'cartao_maquininha');
  btnPixMP.onclick = () => processarLiquidacao(dados.id, 'pix_mp');
  btnCancelar.onclick = () => {
    if (modal) modal.style.display = 'none';
  };
}

export async function processarLiquidacao(pedidoId, formaPagamento) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/finalizar-liquidacao`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ forma_pagamento: formaPagamento })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao processar pagamento.');

    if (modal) modal.style.display = 'none';

    if (formaPagamento === 'pix_mp') {
      exibirQrCodePixMotorista(data.pix);
    } else {
      alert('✅ Corrida encerrada com sucesso! A taxa da plataforma (15%) foi descontada da carteira.');
      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      concluirLimpezaPosCorrida();
    }
  } catch (err) {
    alert(err.message);
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

  btnFechar.onclick = () => {
    if (modalPix) modalPix.style.display = 'none';
  };
}

export function fecharModaisPagamento() {
  const modal1 = document.getElementById('modalEscolhaPagamentoMotorista');
  const modal2 = document.getElementById('modalExibicaoPixMotorista');
  if (modal1) modal1.style.display = 'none';
  if (modal2) modal2.style.display = 'none';
}

export function concluirLimpezaPosCorrida() {
  limparRotasMapa();
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';

  estado.pedidoAtivo = null;
  estado.pedidoAceitoAtual = null;
  carregarPerfil();
  iniciarRadar();
}