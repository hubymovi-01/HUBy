// js/cliente/cliente-testes.js - Painel Sandbox de Testes HUBy
import { estadoCliente } from './cliente-estado.js';
import { notificarCliente } from '../cliente-ui.js';
import { estadoRecursos, criarOuAtualizarVeiculoMapa } from './cliente-recursos.js';

let intervalSimulacaoGPS = null;

export function inicializarPainelTestes() {
  // Cria o botão flutuante discreto de DEV no canto inferior esquerdo
  const btnDev = document.createElement('button');
  btnDev.id = 'btnDevSandbox';
  btnDev.innerHTML = '🧪 Testes';
  btnDev.style.cssText = `
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom, 16px) + 85px);
    left: 14px;
    z-index: 9999;
    background: rgba(15, 23, 42, 0.9);
    border: 1.5px solid #38BDF8;
    color: #38BDF8;
    font-weight: 800;
    font-size: 11px;
    padding: 6px 12px;
    border-radius: 20px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
  `;

  document.body.appendChild(btnDev);

  // Modal com as ferramentas de teste
  const modalTestesHTML = `
    <div id="modalDevSandbox" class="modal-backdrop" style="display: none; z-index: 10020;">
      <div class="modal-card modal-wide" style="border-color: #38BDF8; max-width: 320px;">
        <div class="modal-header-row">
          <h3 style="color: #38BDF8; margin: 0; font-size: 15px;">🧪 Sandbox de Testes</h3>
          <button type="button" id="btnFecharDevSandbox" class="btn-icon-close">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
          <!-- TESTE 1: DESTINO AUTOMÁTICO -->
          <button type="button" id="btnTestarTrajetoFake" style="background: rgba(56, 189, 248, 0.15); border: 1px solid #38BDF8; color: #38BDF8; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            📍 1. Simular Rota & Preço
          </button>

          <!-- TESTE 2: MOTORISTA ACEITAR -->
          <button type="button" id="btnTestarAceiteMotorista" style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10B981; color: #10B981; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            🚗 2. Simular Motorista Aceitando
          </button>

          <!-- TESTE 3: SIMULAR APROVAÇÃO DE PAGAMENTO PIX -->
          <button type="button" id="btnTestarAprovarPix" style="background: rgba(168, 85, 247, 0.15); border: 1px solid #A855F7; color: #C084FC; padding: 10px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer;">
            💠 3. Forçar Aprovação de Pix
          </button>

          <!-- TESTE 4: CONCLUIR VIAGEM -->
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

function configurarAcoesSandbox() {
  const modal = document.getElementById('modalDevSandbox');

  // 1. Simular rota com valores preenchidos
  document.getElementById('btnTestarTrajetoFake')?.addEventListener('click', async () => {
    modal.style.display = 'none';

    // Coordenadas simuladas de teste (origem e destino próximos)
    const origemFake = estadoCliente.coordsOrigem || [-8.3582, -42.2476];
    const destinoFake = [origemFake[0] + 0.012, origemFake[1] + 0.008];

    estadoCliente.coordsDestino = destinoFake;
    const txtDestino = document.getElementById('txtDestinoSelecionado');
    if (txtDestino) txtDestino.textContent = 'Av. Candido Ferraz, 450 (Destino Teste)';

    if (estadoCliente.hubyMapa) {
      const rota = await estadoCliente.hubyMapa.calcularRota(origemFake, destinoFake, '#F59E0B', true);
      estadoCliente.rotaAtual = rota || { preco: '14.50', distancia: '3.2 km', tempo: '7 min' };

      // Atualiza valores nos cards
      const lblCarro = document.getElementById('priceEstCarro');
      const lblMoto = document.getElementById('priceEstMoto');
      const lblEntrega = document.getElementById('priceEstEntrega');
      const lblPrincipal = document.getElementById('txtPrecoEstimado');

      if (lblCarro) lblCarro.textContent = 'R$ 14,50';
      if (lblMoto) lblMoto.textContent = 'R$ 9,50';
      if (lblEntrega) lblEntrega.textContent = 'R$ 11,00';
      if (lblPrincipal) lblPrincipal.textContent = 'R$ 14,50';
    }

    notificarCliente('Rota de teste traçada! Agora você pode clicar em "Confirmar HUBy".', 'sucesso');
  });

  // 2. Simular motorista aceitando a corrida e aproximando no mapa
  document.getElementById('btnTestarAceiteMotorista')?.addEventListener('click', () => {
    modal.style.display = 'none';

    // Cria um pedido falso se não tiver um ativo
    if (!estadoCliente.pedidoAtivoId) {
      estadoCliente.pedidoAtivoId = 'TESTE-' + Math.floor(Math.random() * 9000 + 1000);
      localStorage.setItem('huby_pedido_ativo_id', estadoCliente.pedidoAtivoId);
    }

    // Dispara a interface do motorista aceito
    const dadosMotoristaFake = {
      nome: 'Carlos Eduardo (Teste)',
      telefone: '89999998888',
      veiculo: 'Renault Kwid',
      placa: 'HUB-2026',
      cor: 'Branco',
      avaliacao: 4.9,
      foto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      aceita_dinheiro: true,
      aceita_pix: true,
      aceita_cartao: true
    };

    // Esconde dock de categorias e exibe motorista
    const sliderCategorias = document.getElementById('sliderCategorias');
    const blocoResumo = document.getElementById('blocoResumo');
    const btnPedir = document.getElementById('btnPedirHuby');
    const painel = document.getElementById('painelMotoristaAceitou');

    if (sliderCategorias) sliderCategorias.style.display = 'none';
    if (blocoResumo) blocoResumo.style.display = 'none';
    if (btnPedir) btnPedir.style.display = 'none';

    if (painel) {
      painel.style.display = 'block';
      painel.innerHTML = `
        <div style="text-align: center; margin-bottom: 10px; background: rgba(56, 189, 248, 0.12); border: 1px solid #38BDF8; padding: 10px; border-radius: 12px;">
          <strong style="color: #38BDF8; font-size: 13px;">🚘 Motorista a caminho (SIMULAÇÃO)</strong>
          <div style="color: #FFF; font-size: 15px; font-weight: 800;">Chegando em ~3 minutos</div>
        </div>
        <div style="background: rgba(18, 24, 38, 0.98); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${dadosMotoristaFake.foto}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #10B981;" />
              <div>
                <strong style="color: #FFF; font-size: 14px; display: block;">${dadosMotoristaFake.nome}</strong>
                <small style="color: #F59E0B; font-weight: 700;">⭐ ${dadosMotoristaFake.avaliacao}</small>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="color: #FFF; font-size: 12px; font-weight: 700; display: block;">${dadosMotoristaFake.veiculo}</span>
              <span style="background: #FFF; color: #000; font-family: monospace; font-size: 10px; font-weight: 900; padding: 1px 4px; border-radius: 3px;">${dadosMotoristaFake.placa}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Inicia simulação de veículo no mapa
    if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map) {
      let latInicio = (estadoCliente.coordsOrigem ? estadoCliente.coordsOrigem[0] : -8.3582) + 0.005;
      let lngInicio = (estadoCliente.coordsOrigem ? estadoCliente.coordsOrigem[1] : -42.2476) + 0.005;

      criarOuAtualizarVeiculoMapa(estadoCliente.hubyMapa.map, latInicio, lngInicio, 45, 'carro');

      if (intervalSimulacaoGPS) clearInterval(intervalSimulacaoGPS);
      intervalSimulacaoGPS = setInterval(() => {
        latInicio -= 0.0004;
        lngInicio -= 0.0004;
        criarOuAtualizarVeiculoMapa(estadoCliente.hubyMapa.map, latInicio, lngInicio, 225, 'carro');
      }, 2000);
    }

    notificarCliente('Motorista simulado aceitou e está a caminho!', 'sucesso');
  });

  // 3. Forçar aprovação do Pix de teste
  document.getElementById('btnTestarAprovarPix')?.addEventListener('click', () => {
    modal.style.display = 'none';

    // Fecha o modal de pagamento e exibe confirmação
    const modalPagamento = document.getElementById('modalPagamento');
    const modalPixCorrida = document.getElementById('modalPixCorridaAtivaCliente');
    const txtStatus = document.getElementById('statusPagamentoPixTexto');

    if (txtStatus) {
      txtStatus.textContent = '✅ Pagamento de Teste Aprovado com Sucesso!';
      txtStatus.style.color = '#10B981';
    }

    if (modalPixCorrida) modalPixCorrida.remove();
    setTimeout(() => { if (modalPagamento) modalPagamento.style.display = 'none'; }, 1000);

    notificarCliente('✅ Pix simulado foi liquidado e aprovado!', 'sucesso');
  });

  // 4. Finalizar viagem e chamar avaliação
  document.getElementById('btnTestarFinalizarViagem')?.addEventListener('click', () => {
    modal.style.display = 'none';

    if (intervalSimulacaoGPS) {
      clearInterval(intervalSimulacaoGPS);
      intervalSimulacaoGPS = null;
    }

    const painel = document.getElementById('painelMotoristaAceitou');
    if (painel) {
      painel.style.display = 'none';
      painel.innerHTML = '';
    }

    const modalAvaliacao = document.getElementById('modalAvaliacao');
    if (modalAvaliacao) {
      modalAvaliacao.style.display = 'flex';
      notificarCliente('Viagem concluída! Por favor, avalie a experiência.', 'sucesso');
    }
  });
}