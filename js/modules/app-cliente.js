/**
 * ============================================================================
 * HUBy - Controlador do Aplicativo do Cliente (js/modules/app-cliente.js)
 * ============================================================================
 */

import { CATEGORIAS_HUBY, calcularOrcamentoViagem } from '../config/tarifas.js';
import { MapaService } from '../services/mapa-service.js';
import { ApiClient } from '../services/api-client.js';

const estadoPedido = {
  grupoAtual: 'carro',
  categoriaId: 'passageiro_carro',
  distanciaKm: 3.5,
  duracaoMin: 8,
  qtdAjudantes: 0,
  temEscada: false,
  paradasExtras: 0,
  orcamentoAtual: null
};

const mapa = new MapaService('mapaCliente');

document.addEventListener('DOMContentLoaded', () => {
  // Registar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  // Inicializar Mapa Interativo
  mapa.inicializarMapa((rotaCalculada) => {
    estadoPedido.distanciaKm = rotaCalculada.distanciaKm;
    estadoPedido.duracaoMin = rotaCalculada.duracaoMin;
    document.getElementById('inputDestino').value = 'Ponto selecionado no mapa';
    atualizarInterfaceOrcamento();
  });

  configurarEventosUI();
  renderizarSubVeiculos('carro');
  atualizarInterfaceOrcamento();
});

function configurarEventosUI() {
  // Alternar entre Abas (Viagem | Flash | Cargo)
  document.querySelectorAll('.tab-card').forEach((card) => {
    card.addEventListener('click', () => {
      const grupo = card.dataset.grupo;
      estadoPedido.grupoAtual = grupo;

      document.querySelectorAll('.tab-card').forEach((c) => {
        c.className = 'tab-card';
      });
      card.classList.add(`active-${grupo}`);

      // Mostrar opções de ajudante/escada apenas para Cargo e Utilitários
      const mostrarOpcoesPesadas = grupo === 'cargo';
      document.getElementById('linhaAjudante').style.display = mostrarOpcoesPesadas ? 'flex' : 'none';
      document.getElementById('linhaEscada').style.display = mostrarOpcoesPesadas ? 'flex' : 'none';

      if (!mostrarOpcoesPesadas) {
        estadoPedido.qtdAjudantes = 0;
        estadoPedido.temEscada = false;
        document.getElementById('txtQtdAjudantes').innerText = '0';
        document.getElementById('chkEscada').checked = false;
      }

      renderizarSubVeiculos(grupo);
      atualizarInterfaceOrcamento();
    });
  });

  // Botão GPS Atual
  document.getElementById('btnLocalizarGPS').addEventListener('click', () => {
    mapa.obterGPSAtual(() => {
      document.getElementById('inputOrigem').value = 'GPS: Localização exata ativa';
    });
  });

  // Buscar endereço digitado
  document.getElementById('btnBuscarEndereco').addEventListener('click', async () => {
    const texto = document.getElementById('inputDestino').value.trim();
    if (!texto) return;

    const btn = document.getElementById('btnBuscarEndereco');
    btn.innerText = '...';
    const resultado = await mapa.buscarEnderecoNominatim(texto);
    btn.innerText = 'Ir';

    if (resultado) {
      mapa.definirMarcadorDestino(resultado.lat, resultado.lng);
      const cat = CATEGORIAS_HUBY[estadoPedido.categoriaId];
      const rota = await mapa.calcularRotaOSRM(mapa.coordsOrigem, resultado, cat.corHex);
      estadoPedido.distanciaKm = rota.distanciaKm;
      estadoPedido.duracaoMin = rota.duracaoMin;
      atualizarInterfaceOrcamento();
    } else {
      alert('Endereço não encontrado. Também pode tocar diretamente no mapa!');
    }
  });

  // Controlos de Ajudante (+ e -)
  document.getElementById('btnMaisAjudante').addEventListener('click', () => {
    if (estadoPedido.qtdAjudantes < 4) {
      estadoPedido.qtdAjudantes++;
      document.getElementById('txtQtdAjudantes').innerText = estadoPedido.qtdAjudantes;
      atualizarInterfaceOrcamento();
    }
  });

  document.getElementById('btnMenosAjudante').addEventListener('click', () => {
    if (estadoPedido.qtdAjudantes > 0) {
      estadoPedido.qtdAjudantes--;
      document.getElementById('txtQtdAjudantes').innerText = estadoPedido.qtdAjudantes;
      atualizarInterfaceOrcamento();
    }
  });

  // Checkboxes Escada e Parada Extra
  document.getElementById('chkEscada').addEventListener('change', (e) => {
    estadoPedido.temEscada = e.target.checked;
    atualizarInterfaceOrcamento();
  });

  document.getElementById('chkParadaExtra').addEventListener('change', (e) => {
    estadoPedido.paradasExtras = e.target.checked ? 1 : 0;
    atualizarInterfaceOrcamento();
  });

  // Disparar Pedido HUBy
  document.getElementById('btnSolicitarHuby').addEventListener('click', enviarPedidoViagem);
}

function renderizarSubVeiculos(grupo) {
  const container = document.getElementById('containerSubVeiculos');
  container.innerHTML = '';

  const listaCategorias = Object.values(CATEGORIAS_HUBY).filter((c) => c.grupo === grupo);
  estadoPedido.categoriaId = listaCategorias[0].id;

  listaCategorias.forEach((cat, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `vehicle-pill ${idx === 0 ? 'selected' : ''}`;
    btn.innerText = `${cat.icone} ${cat.nome}`;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.vehicle-pill').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      estadoPedido.categoriaId = cat.id;
      atualizarInterfaceOrcamento();
    });
    container.appendChild(btn);
  });
}

function atualizarInterfaceOrcamento() {
  const orcamento = calcularOrcamentoViagem(
    estadoPedido.categoriaId,
    estadoPedido.distanciaKm,
    estadoPedido.duracaoMin,
    {
      qtdAjudantes: estadoPedido.qtdAjudantes,
      temEscada: estadoPedido.temEscada,
      paradasExtras: estadoPedido.paradasExtras
    }
  );

  estadoPedido.orcamentoAtual = orcamento;

  document.getElementById('txtDistKm').innerText = `${orcamento.distanciaKm} km`;
  document.getElementById('txtDuracaoMin').innerText = orcamento.duracaoMin;
  document.getElementById('txtValorAdicionais').innerText = formatarMoeda(orcamento.valorAdicionais);
  document.getElementById('txtBotaoAcao').innerText = `Chamar ${orcamento.categoria}`;
  document.getElementById('txtPrecoFinal').innerText = formatarMoeda(orcamento.valorTotalCliente);
  document.getElementById('btnSolicitarHuby').style.backgroundColor = orcamento.corHex;
}

async function enviarPedidoViagem() {
  const metodoPagamento = document.getElementById('selectMetodoPgto').value;
  const destinoTexto = document.getElementById('inputDestino').value || 'Destino selecionado no mapa';

  const pedido = await ApiClient.solicitarViagem({
    categoriaId: estadoPedido.categoriaId,
    origemEndereco: document.getElementById('inputOrigem').value,
    destinoEndereco: destinoTexto,
    formaPagamento: metodoPagamento,
    detalhesExtras: {
      qtdAjudantes: estadoPedido.qtdAjudantes,
      temEscada: estadoPedido.temEscada,
      paradasExtras: estadoPedido.paradasExtras
    },
    orcamento: estadoPedido.orcamentoAtual
  });

  const banner = document.getElementById('bannerStatusCorrida');
  banner.style.display = 'block';
  banner.innerHTML = `
    ✅ <strong>Pedido #${pedido.id.slice(0, 6)} enviado!</strong><br>
    A procurar motorista <strong>${estadoPedido.orcamentoAtual.categoria}</strong>...
    <br><a href="/motorista.html" style="color:#10B981;font-weight:900;">[Abrir Painel do Motorista para Aceitar]</a>
  `;
}

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor).toFixed(2).replace('.', ',');
}