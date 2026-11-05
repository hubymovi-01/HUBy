// js/cliente/cliente-testes.js - Painel Sandbox de Testes HUBy
import { estadoCliente } from './cliente-estado.js';
import { notificarCliente } from '../cliente-ui.js';
import { criarOuAtualizarVeiculoMapa } from './cliente-recursos.js';

let intervalSimulacaoGPS = null;

export function inicializarPainelTestes() {
  document.getElementById('btnDevSandbox')?.remove();
  document.getElementById('modalDevSandbox')?.remove();

  // Botão flutuante posicionado no topo esquerdo (para não tapar o dock nem o GPS)
  const btnDev = document.createElement('button');
  btnDev.id = 'btnDevSandbox';
  btnDev.innerHTML = '🧪 Testes';
  btnDev.style.cssText = `
    position: fixed;
    top: calc(env(safe-area-inset-top, 14px) + 68px);
    right: 16px;
    z-index: 9999;
    background: rgba(15, 23, 42, 0.92);
    border: 1.5px solid #38BDF8;
    color: #38BDF8;
    font-weight: 800;
    font-size: 11px;
    padding: 6px 12px;
    border-radius: 20px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
    touch-action: manipulation;
  `;

  document.body.appendChild(btnDev);

  const modalTestesHTML = `
    <div id="modalDevSandbox" class="modal-backdrop" style="display: none; z-index: 10020;">
      <div class="modal-card modal-wide" style="border-color: #38BDF8; max-width: 320px;">
        <div class="modal-header-row">
          <h3 style="color: #38BDF8; margin: 0; font-size: 15px;">🧪 Sandbox de Testes</h3>
          <button type="button" id="btnFecharDevSandbox" class="btn-icon-close">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
          <button type="button" id="btnTestarTrajetoFake" style="background: rgba(56, 189, 248, 0.15); border: 1px solid #38BDF8; color: #38BDF8; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            📍 1. Simular Rota & Preço
          </button>

          <button type="button" id="btnTestarAceiteMotorista" style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10B981; color: #10B981; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            🚗 2. Simular Motorista Aceitando
          </button>

          <button type="button" id="btnTestarAprovarPix" style="background: rgba(168, 85, 247, 0.15); border: 1px solid #A855F7; color: #C084FC; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            💠 3. Forçar Aprovação de Pix
          </button>

          <button type="button" id="btnTestarFinalizarViagem" style="background: rgba(245, 158, 11, 0.15); border: 1px solid #F59E0B; color: #F59E0B; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            🏁 4. Finalizar Corrida & Avaliar
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalTestesHTML);

  const modal = document.getElementById('modalDevSandbox');
  btnDev.addEventListener('click', () => { modal.style.display = 'flex'; });
  document.getElementById('btnFecharDevSandbox')?.addEventListener('click', () => { modal.style.display = 'none'; });

  configurarAcoesSandbox();
}

function alternarModoVisual(modo) {
  // modo: 'selecao' | 'corrida_ativa'
  const blocoResumo = document.getElementById('blocoResumo');
  const sliderCategorias = document.getElementById('sliderCategorias');
  const blocoDetalhesEntrega = document.getElementById('blocoDetalhesEntrega');
  const quickActions = document.querySelector('.dock-quick-actions-row');
  const badgeNota = document.getElementById('txtNotaMotoristaBadge');
  const btnPedir = document.getElementById('btnPedirHuby');
  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  const cardRadar = document.getElementById('cardStatusViagem');

  if (modo === 'corrida_ativa') {
    if (blocoResumo) blocoResumo.style.display = 'none';
    if (sliderCategorias) sliderCategorias.style.display = 'none';
    if (blocoDetalhesEntrega) blocoDetalhesEntrega.style.display = 'none';
    if (quickActions) quickActions.style.display = 'none';
    if (badgeNota) badgeNota.style.display = 'none';
    if (btnPedir) btnPedir.style.display = 'none';
    if (cardRadar) cardRadar.style.display = 'none';
    if (painelMotorista) painelMotorista.style.display = 'block';
  } else {
    if (blocoResumo) blocoResumo.style.display = 'flex';
    if (sliderCategorias) sliderCategorias.style.display = 'grid';
    if (quickActions) quickActions.style.display = 'flex';
    if (btnPedir) btnPedir.style.display = 'flex';
    if (painelMotorista) {
      painelMotorista.style.display = 'none';
      painelMotorista.innerHTML = '';
    }
  }
}

function configurarAcoesSandbox() {
  const modal = document.getElementById('modalDevSandbox');

  // 1. Simular Rota & Preço
  document.getElementById('btnTestarTrajetoFake')?.addEventListener('click', async () => {
    modal.style.display = 'none';
    alternarModoVisual('selecao');

    const origemFake = estadoCliente.coordsOrigem || [-8.3582, -42.2476];
    const destinoFake = [origemFake[0] + 0.010, origemFake[1] + 0.007];

    estadoCliente.coordsDestino = destinoFake;
    const txtDestino = document.getElementById('txtDestinoSelecionado');
    if (txtDestino) txtDestino.textContent = 'Av. Cândido Ferraz, 450 (Teste)';

    if (estadoCliente.hubyMapa) {
      const rota = await estadoCliente.hubyMapa.calcularRota(origemFake, destinoFake, '#F59E0B', true);
      estadoCliente.rotaAtual = rota || { preco: '14.50' };

      const lblCarro = document.getElementById('priceEstCarro');
      const lblMoto = document.getElementById('priceEstMoto');
      const lblEntrega = document.getElementById('priceEstEntrega');
      const lblPrincipal = document.getElementById('txtPrecoEstimado');

      if (lblCarro) lblCarro.textContent = 'R$ 14,50';
      if (lblMoto) lblMoto.textContent = 'R$ 9,50';
      if (lblEntrega) lblEntrega.textContent = 'R$ 11,00';
      if (lblPrincipal) lblPrincipal.textContent = 'R$ 14,50';
    }

    notificarCliente('Rota de teste traçada com sucesso!', 'sucesso');
  });

  // 2. Simular Motorista Aceitando (Transição limpa)
  document.getElementById('btnTestarAceiteMotorista')?.addEventListener('click', () => {
    modal.style.display = 'none';
    alternarModoVisual('corrida_ativa');

    const painel = document.getElementById('painelMotoristaAceitou');
    if (painel) {
      painel.innerHTML = `
        <div style="text-align: center; margin-bottom: 10px; background: rgba(56, 189, 248, 0.12); border: 1px solid #38BDF8; padding: 10px; border-radius: 14px;">
          <strong style="color: #38BDF8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">🚘 Motorista a caminho</strong>
          <div style="color: #FFF; font-size: 16px; font-weight: 800; margin-top: 2px;">Chegando em ~3 minutos</div>
        </div>

        <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80" 
                style="width: 46px; height: 46px; border-radius: 50%; object-fit: cover; border: 2px solid #10B981;" />
              <div>
                <strong style="color: #FFF; font-size: 14px; display: block;">Carlos Eduardo</strong>
                <small style="color: #F59E0B; font-weight: 700;">⭐ 4.9 • Renault Kwid Branco</small>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="background: #FFF; color: #000; font-family: monospace; font-size: 11px; font-weight: 900; padding: 2px 6px; border-radius: 4px;">HUB-2026</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
            <a href="tel:89999998888" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #FFF; font-weight: 800; padding: 8px; border-radius: 10px; text-decoration: none; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 5px;">
              📞 Ligar
            </a>
            <button type="button" id="btnChatSimulacao" style="background: rgba(56,189,248,0.18); border: 1px solid #38BDF8; color: #38BDF8; font-weight: 800; padding: 8px; border-radius: 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;">
              💬 Mensagem
            </button>
          </div>
        </div>
      `;

      document.getElementById('btnChatSimulacao')?.addEventListener('click', () => {
        const modalChat = document.getElementById('modalChatCorrida');
        if (modalChat) modalChat.style.display = 'flex';
      });
    }

    // Animação realista do carro a avançar no mapa
    if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map) {
      let lat = (estadoCliente.coordsOrigem ? estadoCliente.coordsOrigem[0] : -8.3582) + 0.006;
      let lng = (estadoCliente.coordsOrigem ? estadoCliente.coordsOrigem[1] : -42.2476) + 0.005;

      criarOuAtualizarVeiculoMapa(estadoCliente.hubyMapa.map, lat, lng, 220, 'carro');

      if (intervalSimulacaoGPS) clearInterval(intervalSimulacaoGPS);
      intervalSimulacaoGPS = setInterval(() => {
        lat -= 0.0003;
        lng -= 0.00025;
        criarOuAtualizarVeiculoMapa(estadoCliente.hubyMapa.map, lat, lng, 220, 'carro');
      }, 1500);
    }

    notificarCliente('Motorista simulado a caminho!', 'sucesso');
  });

  // 3. Forçar Aprovação de Pix
  document.getElementById('btnTestarAprovarPix')?.addEventListener('click', () => {
    modal.style.display = 'none';

    const modalPagamento = document.getElementById('modalPagamento');
    const modalPixCorrida = document.getElementById('modalPixCorridaAtivaCliente');
    const txtStatus = document.getElementById('statusPagamentoPixTexto');

    if (txtStatus) {
      txtStatus.textContent = '✅ Pagamento de Teste Aprovado!';
      txtStatus.style.color = '#10B981';
    }

    if (modalPixCorrida) modalPixCorrida.remove();
    setTimeout(() => { if (modalPagamento) modalPagamento.style.display = 'none'; }, 1000);

    notificarCliente('Pix simulado aprovado com sucesso!', 'sucesso');
  });

  // 4. Finalizar Corrida & Avaliar
  document.getElementById('btnTestarFinalizarViagem')?.addEventListener('click', () => {
    modal.style.display = 'none';

    if (intervalSimulacaoGPS) {
      clearInterval(intervalSimulacaoGPS);
      intervalSimulacaoGPS = null;
    }

    if (estadoCliente.hubyMapa?.markerDestino && estadoCliente.hubyMapa?.map) {
      estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.markerDestino);
      estadoCliente.hubyMapa.markerDestino = null;
    }
    if (estadoCliente.hubyMapa?.linhaRota && estadoCliente.hubyMapa?.map) {
      estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.linhaRota);
      estadoCliente.hubyMapa.linhaRota = null;
    }

    alternarModoVisual('selecao');

    const modalAvaliacao = document.getElementById('modalAvaliacao');
    if (modalAvaliacao) {
      modalAvaliacao.style.display = 'flex';
    }
  });
}