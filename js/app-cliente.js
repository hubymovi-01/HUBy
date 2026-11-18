// js/app-cliente.js - Orquestrador Principal HUBy Passageiro (Com Publicidade, Vitrine de Parceiros e Sincronia 3D)
import { API_URL, sonsHUBy, sincronizarTarifasServidor, calcularPreco, aplicarObjetoTarifas } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=6';
import { estadoCliente } from './cliente/cliente-estado.js';
import { carregarSaldoCarteiraCliente, configurarDrawerMenu, verificarAcessoAdminMenu, fecharDrawer, carregarEExibirHistoricoModal } from './cliente/cliente-ui-menu.js';
import { configurarModalAvaliacao, configurarBotoesGorjeta } from './cliente/cliente-avaliacao.js';
import { atualizarBotaoChamar, atualizarResumoValores, submeterPedido, cancelarBusca, resetarPainelCliente } from './cliente/cliente-pedidos.js?v=3.0.0';
import { configurarChatCliente, encerrarMonitoramentoChatCliente } from './cliente/cliente-chat.js';
import { notificar } from './util/alertas-huby.js';
import { abrirPromptParada } from './cliente-ui.js';
import {
  configurarSeletorPagamentoRapido,
  configurarNotaMotorista,
  configurarCupomDesconto,
  criarOuAtualizarVeiculoMapa,
  estadoRecursos
} from './cliente/cliente-recursos.js';

let intervalChecagemPix = null;
let alertaProximidadeEmitido = false;
let cachePatrocinadoresAtivos = [];
let categoriaFiltroParceiro = 'todos';

function escaparHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extrairDistanciaKmDaRota(rota) {
  if (!rota) return 0;
  const bruta = Number(
    rota.distanciaKm ??
    rota.distancia_km ??
    rota.distancia ??
    (rota.distance ? rota.distance / 1000 : 0)
  );
  if (Number.isFinite(bruta) && bruta > 0) {
    return bruta;
  }
  if (estadoCliente.coordsOrigem && estadoCliente.coordsDestino) {
    const m = calcularDistanciaMetros(
      estadoCliente.coordsOrigem[0],
      estadoCliente.coordsOrigem[1],
      estadoCliente.coordsDestino[0],
      estadoCliente.coordsDestino[1]
    );
    return Math.max(0.2, Number(((m / 1000) * 1.3).toFixed(2)));
  }
  return 0;
}

function sincronizarPrecosDaRotaAtual() {
  if (!estadoCliente.rotaAtual && !estadoCliente.coordsDestino) {
    atualizarValoresCardsPro(0);
    return;
  }

  const distKm = extrairDistanciaKmDaRota(estadoCliente.rotaAtual);
  if (!distKm || distKm <= 0) {
    atualizarValoresCardsPro(0);
    return;
  }

  const catSelecionada = estadoCliente.categoriaSelecionada || 'carro';
  const calcSelecionada = calcularPreco(catSelecionada, distKm);

  if (estadoCliente.rotaAtual) {
    estadoCliente.rotaAtual.distanciaKm = distKm;
    estadoCliente.rotaAtual.distancia = distKm;
    estadoCliente.rotaAtual.preco = calcSelecionada.valorTotal;
    estadoCliente.rotaAtual.valorTotal = calcSelecionada.valorTotal;
  }

  atualizarResumoValores();
  atualizarValoresCardsPro(calcSelecionada.valorTotal, distKm);
}

export function alternarModoVisualViagemAtiva(emViagem = false) {
  const elementosParaEsconder = [
    document.getElementById('sliderCategorias'),
    document.getElementById('cardsCategorias'),
    document.getElementById('blocoResumo'),
    document.getElementById('blocoDetalhesEntrega'),
    document.getElementById('cardStatusViagem'),
    document.getElementById('containerParadasIntermediarias'),
    document.getElementById('btnAddParada'),
    document.querySelector('.modern-search'),
    document.querySelector('.quick-features-bar'),
    document.querySelector('.dock-quick-actions-row')
  ];

  elementosParaEsconder.forEach(el => {
    if (el) {
      el.style.display = emViagem ? 'none' : '';
    }
  });

  const btnPedir = document.getElementById('btnPedirHuby');
  if (btnPedir) {
    btnPedir.style.setProperty('display', emViagem ? 'none' : 'flex', 'important');
  }

  const cardsPro = document.querySelectorAll('.category-card-pro');
  cardsPro.forEach(c => {
    c.style.display = emViagem ? 'none' : '';
  });

  const painelAtivo = document.getElementById('painelMotoristaAceitou') || document.getElementById('cardStatusViagemPassageiro');
  if (painelAtivo) {
    painelAtivo.style.display = emViagem ? 'block' : 'none';
  }
}

function atualizarValoresCardsPro(precoBase, distanciaForcadaKm = null) {
  const lblCarro = document.getElementById('priceEstCarro');
  const lblMoto = document.getElementById('priceEstMoto');
  const lblEntrega = document.getElementById('priceEstEntrega');
  const lblPrincipal = document.getElementById('txtPrecoEstimado');

  const distKm = distanciaForcadaKm ?? extrairDistanciaKmDaRota(estadoCliente.rotaAtual);

  if ((!precoBase || precoBase <= 0) && (!distKm || distKm <= 0)) {
    if (lblCarro) lblCarro.textContent = '--';
    if (lblMoto) lblMoto.textContent = '--';
    if (lblEntrega) lblEntrega.textContent = '--';
    if (lblPrincipal) lblPrincipal.textContent = '--';
    return;
  }

  const fatorDesconto = estadoRecursos.descontoPercentual > 0 ? (1 - estadoRecursos.descontoPercentual) : 1;
  const paradasExtras = (estadoCliente.paradasIntermediarias?.length || 0) * 3.00;

  let numCarro, numMoto, numEntrega;

  if (distKm > 0) {
    numCarro = (calcularPreco('carro', distKm).valorTotal + paradasExtras) * fatorDesconto;
    numMoto = (calcularPreco('moto', distKm).valorTotal + paradasExtras) * fatorDesconto;
    numEntrega = (calcularPreco('entrega', distKm).valorTotal + paradasExtras) * fatorDesconto;
  } else {
    numCarro = precoBase * fatorDesconto;
    numMoto = precoBase * 0.65 * fatorDesconto;
    numEntrega = precoBase * 0.75 * fatorDesconto;
  }

  const valCarro = numCarro.toFixed(2).replace('.', ',');
  const valMoto = numMoto.toFixed(2).replace('.', ',');
  const valEntrega = numEntrega.toFixed(2).replace('.', ',');

  if (lblCarro) lblCarro.textContent = `R$ ${valCarro}`;
  if (lblMoto) lblMoto.textContent = `R$ ${valMoto}`;
  if (lblEntrega) lblEntrega.textContent = `R$ ${valEntrega}`;

  let valAtual = valCarro;
  let numAtual = numCarro;
  if (estadoCliente.categoriaSelecionada === 'moto') {
    valAtual = valMoto;
    numAtual = numMoto;
  } else if (estadoCliente.categoriaSelecionada === 'entrega') {
    valAtual = valEntrega;
    numAtual = numEntrega;
  }

  if (estadoCliente.rotaAtual) {
    estadoCliente.rotaAtual.preco = Number(numAtual.toFixed(2));
    estadoCliente.rotaAtual.valorTotal = Number(numAtual.toFixed(2));
  }

  if (lblPrincipal) lblPrincipal.textContent = `R$ ${valAtual}`;
}

function configurarParadasIntermediariasSemPrompt() {
  const btnAdd = document.getElementById('btnAddParada');
  const container = document.getElementById('containerParadasIntermediarias');

  btnAdd?.addEventListener('click', () => {
    if (!estadoCliente.coordsDestino) {
      notificar('Selecione primeiro o destino final no mapa.', 'alerta');
      return;
    }

    if (estadoCliente.paradasIntermediarias && estadoCliente.paradasIntermediarias.length >= 2) {
      notificar('Limite máximo de 2 paradas intermediárias atingido.', 'alerta');
      return;
    }

    abrirPromptParada({
      titulo: 'Adicionar Parada',
      placeholder: 'Ex: Farmácia, Banco, Padaria...',
      onConfirmar: (enderecoParada) => {
        if (!estadoCliente.paradasIntermediarias) {
          estadoCliente.paradasIntermediarias = [];
        }

        estadoCliente.paradasIntermediarias.push({
          endereco: enderecoParada,
          lat: null,
          lng: null
        });

        if (container) {
          const item = document.createElement('div');
          item.className = 'stop-row';
          const seguro = escaparHTML(enderecoParada);
          item.innerHTML = `
            <span>📍 Parada: <strong>${seguro}</strong></span>
            <button type="button" class="stop-remove-btn" title="Remover parada">✕</button>
          `;

          item.querySelector('.stop-remove-btn').addEventListener('click', () => {
            const index = estadoCliente.paradasIntermediarias.findIndex(p => p.endereco === enderecoParada);
            if (index > -1) estadoCliente.paradasIntermediarias.splice(index, 1);
            item.remove();
            sincronizarPrecosDaRotaAtual();
          });

          container.appendChild(item);
        }

        notificar(`Parada adicionada: ${enderecoParada}`, 'sucesso');
        sincronizarPrecosDaRotaAtual();
      }
    });
  });
}

function configurarBarraPesquisaAnimada() {
  const searchBox = document.querySelector('.modern-search');
  const btnLupa = document.getElementById('btnAcionarPesquisa');
  const btnBuscaIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');
  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const containerParadas = document.getElementById('containerParadasIntermediarias');

  function atualizarVisibilidadeLimpar() {
    if (btnLimpar) {
      btnLimpar.style.display = inputPesquisa?.value.trim() ? 'flex' : 'none';
    }
  }

  function recolherBarra() {
    searchBox?.classList.remove('active');
    if (inputPesquisa) {
      inputPesquisa.value = '';
      inputPesquisa.blur();
    }
    if (listaResultados) {
      listaResultados.innerHTML = '';
      listaResultados.style.display = 'none';
    }
    atualizarVisibilidadeLimpar();
  }

  inputPesquisa?.addEventListener('input', atualizarVisibilidadeLimpar);

  inputPesquisa?.addEventListener('click', (e) => {
    e.stopPropagation();
    searchBox?.classList.add('active');
    atualizarVisibilidadeLimpar();
  });

  btnLupa?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    searchBox?.classList.add('active');
    inputPesquisa?.focus();
    atualizarVisibilidadeLimpar();
  });

  searchBox?.addEventListener('click', (e) => {
    if (
      e.target === btnLimpar || btnLimpar?.contains(e.target) ||
      e.target === btnBuscaIA || btnBuscaIA?.contains(e.target)
    ) {
      return;
    }
    searchBox?.classList.add('active');
    inputPesquisa?.focus();
    atualizarVisibilidadeLimpar();
  });

  btnLimpar?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    recolherBarra();

    estadoCliente.coordsDestino = null;
    estadoCliente.rotaAtual = null;
    if (estadoCliente.paradasIntermediarias) {
      estadoCliente.paradasIntermediarias = [];
    }

    if (estadoCliente.hubyMapa) {
      if (estadoCliente.hubyMapa.rotaLayer && estadoCliente.hubyMapa.map) {
        estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.rotaLayer);
        estadoCliente.hubyMapa.rotaLayer = null;
      }
      if (estadoCliente.hubyMapa.markerDestino && estadoCliente.hubyMapa.map) {
        estadoCliente.hubyMapa.map.removeLayer(estadoCliente.hubyMapa.markerDestino);
        estadoCliente.hubyMapa.markerDestino = null;
      }
    }

    if (txtDestino) txtDestino.textContent = 'Selecione no mapa ou pesquise';
    if (containerParadas) containerParadas.innerHTML = '';
    atualizarValoresCardsPro(0);
    atualizarResumoValores();
  });

  document.getElementById('mapaCliente')?.addEventListener('click', () => {
    if (searchBox?.classList.contains('active') && !inputPesquisa?.value.trim()) {
      recolherBarra();
    }
  });
}

function configurarAlternanciaSatélite() {
  const btnCamada = document.getElementById('btnAlternarCamadaMapa');
  let modoSatelite = false;
  let layerSatelite = null;

  btnCamada?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!estadoCliente.hubyMapa || !estadoCliente.hubyMapa.map) return;
    const map = estadoCliente.hubyMapa.map;

    modoSatelite = !modoSatelite;

    if (modoSatelite) {
      btnCamada.classList.add('modo-satelite');
      if (!layerSatelite) {
        layerSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          attribution: 'Esri Satellite'
        });
      }
      layerSatelite.addTo(map);
      notificar('Visão Satélite ativada', 'info');
    } else {
      btnCamada.classList.remove('modo-satelite');
      if (layerSatelite && map.hasLayer(layerSatelite)) {
        map.removeLayer(layerSatelite);
      }
      notificar('Mapa Noturno ativado', 'info');
    }
  });
}

function configurarLocaisFavoritosMenu() {
  const modalFav = document.getElementById('modalConfigFavorito');
  const btnFecharModal = document.getElementById('btnFecharModalFav');
  const tituloModal = document.getElementById('tituloModalFav');
  const inputTexto = document.getElementById('inputEnderecoFavTexto');
  const btnSalvarTexto = document.getElementById('btnSalvarFavTexto');
  const btnMarcarMapa = document.getElementById('btnMarcarFavNoMapa');

  let tipoEditando = null;
  let labelEditando = '';

  function abrirModalEdicao(tipo, label) {
    fecharDrawer();
    tipoEditando = tipo;
    labelEditando = label;

    if (tituloModal) tituloModal.textContent = `Configurar ${label}`;
    if (inputTexto) {
      inputTexto.value = localStorage.getItem(`huby_endereco_${tipo}`) || '';
      setTimeout(() => inputTexto.focus(), 100);
    }
    if (modalFav) modalFav.style.display = 'flex';
  }

  function fecharModalEdicao() {
    if (modalFav) modalFav.style.display = 'none';
    tipoEditando = null;
  }

  btnFecharModal?.addEventListener('click', fecharModalEdicao);

  document.getElementById('btnEditarCasa')?.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirModalEdicao('casa', 'Minha Casa');
  });

  document.getElementById('btnEditarTrabalho')?.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirModalEdicao('trabalho', 'Meu Trabalho');
  });

  btnSalvarTexto?.addEventListener('click', async () => {
    const endereco = inputTexto?.value.trim();
    if (!endereco || !tipoEditando) {
      notificar('Digite um endereço antes de salvar.', 'alerta');
      return;
    }

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&limit=1`);
      const dados = await resp.json();

      if (dados && dados.length > 0) {
        const coords = [parseFloat(dados[0].lat), parseFloat(dados[0].lon)];
        localStorage.setItem(`huby_endereco_${tipoEditando}`, endereco);
        localStorage.setItem(`huby_coords_${tipoEditando}`, JSON.stringify(coords));

        const descElem = document.getElementById(tipoEditando === 'casa' ? 'txtMenuCasaDesc' : 'txtMenuTrabalhoDesc');
        if (descElem) descElem.textContent = endereco;

        notificar(`${labelEditando} cadastrado com sucesso!`, 'sucesso');
        fecharModalEdicao();
      } else {
        notificar('Endereço não localizado no mapa. Detalhe com mais informações.', 'alerta');
      }
    } catch (e) {
      notificar('Falha ao conectar com serviço de busca.', 'erro');
    }
  });

  btnMarcarMapa?.addEventListener('click', () => {
    if (!tipoEditando) return;
    const tipoAlvo = tipoEditando;
    const labelAlvo = labelEditando;

    fecharModalEdicao();
    notificar(`Toque no mapa para indicar "${labelAlvo}"`, 'info');

    if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map) {
      const mapaLeaflet = estadoCliente.hubyMapa.map;

      function onToqueMapa(e) {
        mapaLeaflet.off('click', onToqueMapa);
        const { lat, lng } = e.latlng;
        const coords = [lat, lng];
        const nomeFormatado = `${labelAlvo} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        localStorage.setItem(`huby_endereco_${tipoAlvo}`, nomeFormatado);
        localStorage.setItem(`huby_coords_${tipoAlvo}`, JSON.stringify(coords));

        const descElem = document.getElementById(tipoAlvo === 'casa' ? 'txtMenuCasaDesc' : 'txtMenuTrabalhoDesc');
        if (descElem) descElem.textContent = nomeFormatado;

        notificar(`Localização de "${labelAlvo}" salva!`, 'sucesso');
      }

      mapaLeaflet.once('click', onToqueMapa);
    }
  });

  async function acionarIrParaFavorito(tipo, label) {
    fecharDrawer();
    const enderecoSalvo = localStorage.getItem(`huby_endereco_${tipo}`);
    const coordsSalvas = localStorage.getItem(`huby_coords_${tipo}`);

    if (!enderecoSalvo || !coordsSalvas) {
      abrirModalEdicao(tipo, label);
      return;
    }

    const coords = JSON.parse(coordsSalvas);
    if (estadoCliente.pedidoAtivoId) return;

    await sincronizarTarifasServidor();
    estadoCliente.coordsDestino = coords;
    const txtDestino = document.getElementById('txtDestinoSelecionado');
    const inputPesquisa = document.getElementById('inputPesquisaLocal');
    const searchBox = document.querySelector('.modern-search');

    if (txtDestino) txtDestino.textContent = enderecoSalvo;
    if (inputPesquisa) inputPesquisa.value = enderecoSalvo;
    if (searchBox) searchBox.classList.add('active');

    if (estadoCliente.hubyMapa) {
      const origem = estadoCliente.coordsOrigem ||
        (estadoCliente.hubyMapa.posicaoAtual ? [estadoCliente.hubyMapa.posicaoAtual.lat, estadoCliente.hubyMapa.posicaoAtual.lng] : null) ||
        [-8.3582, -42.2476];
      const rota = await estadoCliente.hubyMapa.calcularRota(origem, coords, '#F59E0B', true);
      estadoCliente.rotaAtual = rota;
      sincronizarPrecosDaRotaAtual();
    }
  }

  document.getElementById('actionIrCasa')?.addEventListener('click', () => {
    acionarIrParaFavorito('casa', 'Minha Casa');
  });

  document.getElementById('actionIrTrabalho')?.addEventListener('click', () => {
    acionarIrParaFavorito('trabalho', 'Meu Trabalho');
  });
}

// ----------------------------------------------------------------------
// SISTEMA DE AGENDAMENTO E OBSERVAÇÃO DECORADA
// ----------------------------------------------------------------------
function configurarSistemaAgendamento() {
  const btnAgendar = document.getElementById('btnAgendarViagem');
  const btnLimparAgendamento = document.getElementById('btnLimparAgendamento');
  const badgeAgendamento = document.getElementById('txtAgendamentoBadge');
  
  if (!btnAgendar) return;

  btnAgendar.addEventListener('click', () => {
    const dataInputStr = prompt("Para quando deseja agendar? (Digite no formato AAAA-MM-DD HH:MM)\n\nEx: 2026-12-25 14:30\n(O mínimo é 30 minutos de antecedência)");
    if (!dataInputStr) return;

    const datePattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
    const m = dataInputStr.match(datePattern);
    
    if (!m) {
      notificar('Formato de data inválido. Use AAAA-MM-DD HH:MM', 'erro');
      return;
    }

    const dtAgendada = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
    const diffMs = dtAgendada.getTime() - Date.now();

    if (isNaN(dtAgendada.getTime()) || diffMs < (25 * 60 * 1000)) {
      notificar('A hora de agendamento deve ser pelo menos 30 minutos a partir de agora.', 'erro');
      return;
    }

    estadoRecursos.dataAgendada = dtAgendada.toISOString();
    btnAgendar.style.background = 'rgba(245, 158, 11, 0.2)';
    btnAgendar.style.color = '#F59E0B';
    btnAgendar.style.borderColor = '#F59E0B';

    if (badgeAgendamento) {
      badgeAgendamento.style.display = 'block';
      badgeAgendamento.innerHTML = `⏰ Agendada para: <strong>${dtAgendada.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short'})}</strong>`;
    }
    
    if (btnLimparAgendamento) btnLimparAgendamento.style.display = 'flex';
    notificar('Viagem agendada! Confirme no botão principal.', 'sucesso');
  });

  if (btnLimparAgendamento) {
    btnLimparAgendamento.addEventListener('click', (e) => {
      e.stopPropagation();
      estadoRecursos.dataAgendada = null;
      btnAgendar.style.background = '';
      btnAgendar.style.color = '';
      btnAgendar.style.borderColor = '';
      if (badgeAgendamento) badgeAgendamento.style.display = 'none';
      btnLimparAgendamento.style.display = 'none';
      notificar('Agendamento removido.', 'info');
    });
  }
}

// ----------------------------------------------------------------------
// PREPARAR E ENVIAR PEDIDO AO SERVIDOR COM PAGAMENTO, CUPOM E NOTAS
// ----------------------------------------------------------------------
async function iniciarSubmissaoPedidoFinal() {
  if (estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id')) {
    await cancelarBusca();
    return;
  }
  if (!estadoCliente.coordsDestino || !estadoCliente.rotaAtual) {
    notificar('Selecione um destino no mapa antes de confirmar.', 'alerta');
    return;
  }

  const textNota = estadoRecursos?.notaMotorista || '';
  if (textNota && !estadoCliente.paradasIntermediarias) {
    estadoCliente.paradasIntermediarias = [];
  }
  if (textNota) {
    const indexNota = estadoCliente.paradasIntermediarias.findIndex(p => p.nota);
    if (indexNota > -1) {
      estadoCliente.paradasIntermediarias[indexNota].nota = textNota;
    } else {
      estadoCliente.paradasIntermediarias.push({ nota: textNota });
    }
  }

  const dataAgendada = estadoRecursos?.dataAgendada || null;
  if (dataAgendada) {
    estadoCliente.rotaAtual.agendadoPara = dataAgendada;
  }

  const metodoLocal = localStorage.getItem('huby_metodo_pgto_padrao') || 'dinheiro';
  estadoCliente.rotaAtual.forma_pagamento = metodoLocal;
  estadoCliente.rotaAtual.metodo_pgto = metodoLocal;

  if (estadoRecursos?.cupomAtivo) {
    estadoCliente.rotaAtual.cupomCodigo = estadoRecursos.cupomAtivo.codigo;
  }

  estadoCliente.rotaAtual.subTipoId = estadoCliente.categoriaSelecionada || 'carro';
  estadoCliente.rotaAtual.subTipoLabel = `HUBy ${String(estadoCliente.categoriaSelecionada).charAt(0).toUpperCase() + String(estadoCliente.categoriaSelecionada).slice(1)}`;

  sincronizarPrecosDaRotaAtual();
  await submeterPedido(); 
}

document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('hubySplash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 400);
  }

  await sincronizarTarifasServidor();
  await carregarSaldoCarteiraCliente();
  atualizarValoresCardsPro(0);

  try {
    if (!estadoCliente.hubyMapa) {
      estadoCliente.hubyMapa = new HubyMapa('mapaCliente');
    }

    estadoCliente.hubyMapa.inicializar(async (rota, coords) => {
      if (estadoCliente.pedidoAtivoId) return;

      await sincronizarTarifasServidor();
      estadoCliente.coordsDestino = [coords.lat, coords.lng];
      estadoCliente.rotaAtual = rota;

      const txtDestino = document.getElementById('txtDestinoSelecionado');
      const inputPesquisa = document.getElementById('inputPesquisaLocal');
      const searchBox = document.querySelector('.modern-search');
      const btnLimpar = document.getElementById('btnLimparPesquisa');
      const listaResultados = document.getElementById('listaResultadosPesquisa');

      const textoDestino = `Destino (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;

      if (txtDestino) txtDestino.textContent = textoDestino;
      if (inputPesquisa) {
        inputPesquisa.value = textoDestino;
        if (btnLimpar) btnLimpar.style.display = 'flex';
      }
      if (searchBox) searchBox.classList.add('active');
      if (listaResultados) {
        listaResultados.innerHTML = '';
        listaResultados.style.display = 'none';
      }

      sincronizarPrecosDaRotaAtual();
    });

    estadoCliente.hubyMapa.obterGPS?.((pos) => {
      if (pos && pos.lat && pos.lng) {
        estadoCliente.coordsOrigem = [pos.lat, pos.lng];
      }
    });

    setTimeout(() => {
      if (estadoCliente.hubyMapa?.map) {
        estadoCliente.hubyMapa.map.invalidateSize();
      }
    }, 250);
  } catch (err) {
    console.warn('Aviso no mapa:', err);
  }

  if (estadoCliente.hubyMapa) {
    configurarPesquisaLocal(estadoCliente.hubyMapa, async (rota, coords, nomeCurto) => {
      await sincronizarTarifasServidor();
      estadoCliente.rotaAtual = rota;
      estadoCliente.coordsDestino = coords;

      const txtDestino = document.getElementById('txtDestinoSelecionado');
      const inputPesquisa = document.getElementById('inputPesquisaLocal');
      const btnLimpar = document.getElementById('btnLimparPesquisa');
      const searchBox = document.querySelector('.modern-search');
      const listaResultados = document.getElementById('listaResultadosPesquisa');

      if (txtDestino) txtDestino.textContent = nomeCurto;
      if (inputPesquisa) {
        inputPesquisa.value = nomeCurto;
        if (btnLimpar) btnLimpar.style.display = 'flex';
      }
      if (searchBox) searchBox.classList.add('active');
      if (listaResultados) {
        listaResultados.innerHTML = '';
        listaResultados.style.display = 'none';
      }

      sincronizarPrecosDaRotaAtual();
    });
  }

  configurarParadasIntermediariasSemPrompt();
  configurarBarraPesquisaAnimada();
  configurarAlternanciaSatélite();
  configurarLocaisFavoritosMenu();

  configurarSeletorPagamentoRapido();
  configurarCupomDesconto();
  configurarNotaMotorista();
  configurarSistemaAgendamento();

  const processarDestinoIA = async (e) => {
    const dados = e.detail || {};
    const nome = dados.nome || 'Destino Selecionado';

    let coordsDestino = null;
    if (Array.isArray(dados.coords) && dados.coords.length === 2) {
      coordsDestino = [parseFloat(dados.coords[0]), parseFloat(dados.coords[1])];
    } else if (dados.lat && dados.lng) {
      coordsDestino = [parseFloat(dados.lat), parseFloat(dados.lng)];
    }

    if (!coordsDestino || isNaN(coordsDestino[0]) || isNaN(coordsDestino[1])) {
      return;
    }

    await sincronizarTarifasServidor();
    estadoCliente.coordsDestino = coordsDestino;

    const txtDestino = document.getElementById('txtDestinoSelecionado');
    const inputPesquisa = document.getElementById('inputPesquisaLocal');
    const btnLimpar = document.getElementById('btnLimparPesquisa');
    const searchBox = document.querySelector('.modern-search');
    const listaResultados = document.getElementById('listaResultadosPesquisa');

    if (txtDestino) {
      txtDestino.textContent = nome;
      txtDestino.style.color = '#38BDF8';
      txtDestino.style.fontWeight = '800';
    }

    if (inputPesquisa) {
      inputPesquisa.value = nome;
      inputPesquisa.blur();
      if (btnLimpar) btnLimpar.style.display = 'flex';
    }

    if (searchBox) searchBox.classList.add('active');
    if (listaResultados) {
      listaResultados.innerHTML = '';
      listaResultados.style.display = 'none';
    }

    if (estadoCliente.hubyMapa) {
      let origem = estadoCliente.coordsOrigem;

      if (!origem && estadoCliente.hubyMapa.posicaoAtual) {
        origem = [estadoCliente.hubyMapa.posicaoAtual.lat, estadoCliente.hubyMapa.posicaoAtual.lng];
      }

      if (!origem && estadoCliente.hubyMapa.userMarker) {
        const markerPos = estadoCliente.hubyMapa.userMarker.getLatLng();
        origem = [markerPos.lat, markerPos.lng];
      }

      if (!origem && estadoCliente.hubyMapa.markerOrigem) {
        const markerPos = estadoCliente.hubyMapa.markerOrigem.getLatLng();
        origem = [markerPos.lat, markerPos.lng];
      }

      if (!origem) {
        const centroPadrao = estadoCliente.hubyMapa.map?.getCenter();
        origem = centroPadrao ? [centroPadrao.lat, centroPadrao.lng] : [-8.3582, -42.2476];
      }

      estadoCliente.coordsOrigem = origem;

      try {
        const rota = await estadoCliente.hubyMapa.calcularRota(origem, coordsDestino, '#38BDF8', true);
        estadoCliente.rotaAtual = rota;

        if (rota?.geometria && typeof estadoCliente.hubyMapa.desenharRota === 'function') {
          estadoCliente.hubyMapa.desenharRota(rota.geometria, '#38BDF8');
        }

        sincronizarPrecosDaRotaAtual();

        setTimeout(() => {
          if (estadoCliente.hubyMapa.map) {
            estadoCliente.hubyMapa.map.invalidateSize();
          }
        }, 150);
      } catch (errRota) {
        console.error('❌ Erro ao traçar rota no mapa:', errRota);
      }
    }
  };

  window.removeEventListener('huby_local_selecionado_ia', processarDestinoIA);
  window.addEventListener('huby_local_selecionado_ia', processarDestinoIA);

  const btnGPS = document.getElementById('btnLocalizarGPS');
  if (btnGPS) {
    btnGPS.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (estadoCliente.hubyMapa) {
        estadoCliente.hubyMapa.obterGPS((posicaoReal) => {
          if (posicaoReal && posicaoReal.lat && posicaoReal.lng) {
            estadoCliente.coordsOrigem = [posicaoReal.lat, posicaoReal.lng];
          }
          if (estadoCliente.coordsDestino) {
            estadoCliente.hubyMapa.calcularRota([posicaoReal.lat, posicaoReal.lng], estadoCliente.coordsDestino, '#F59E0B', true).then(rota => {
              estadoCliente.rotaAtual = rota;
              sincronizarPrecosDaRotaAtual();
            });
          }
        });
      }
    });
  }

  configurarDrawerMenu();
  verificarAcessoAdminMenu();

  document.getElementById('btnNavViagens')?.addEventListener('click', carregarEExibirHistoricoModal);
  document.getElementById('menuItemViagens')?.addEventListener('click', () => {
    fecharDrawer();
    carregarEExibirHistoricoModal();
  });
  document.getElementById('btnFecharHistorico')?.addEventListener('click', () => {
    const modal = document.getElementById('modalHistorico');
    if (modal) modal.style.display = 'none';
  });

  const cardsPro = document.querySelectorAll('.category-card-pro');
  cardsPro.forEach(card => {
    card.addEventListener('click', () => {
      cardsPro.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      estadoCliente.categoriaSelecionada = card.getAttribute('data-id') || 'carro';

      const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
      if (blocoEntrega) {
        blocoEntrega.style.display = (estadoCliente.categoriaSelecionada === 'entrega') ? 'block' : 'none';
      }

      const nomeExibicao = estadoCliente.categoriaSelecionada === 'moto' ? 'Moto' : (estadoCliente.categoriaSelecionada === 'entrega' ? 'Flash' : 'Carro');
      const btnText = document.querySelector('.pro-btn .btn-text');
      if (btnText) btnText.textContent = `Confirmar HUBy ${nomeExibicao}`;

      if (estadoCliente.rotaAtual || estadoCliente.coordsDestino) {
        sincronizarPrecosDaRotaAtual();
      }
    });
  });

  document.getElementById('btnPedirHuby')?.addEventListener('click', iniciarSubmissaoPedidoFinal);

  configurarModalAvaliacao();
  configurarBotoesGorjeta();
  configurarFluxoPagamentoMercadoPago();

  const pedidoAtivoSalvo = localStorage.getItem('huby_pedido_ativo_id');
  if (pedidoAtivoSalvo) {
    configurarChatCliente(pedidoAtivoSalvo);
  }

  conectarSocketEPollingCliente();
  inicializarPatrocinadoresCliente();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

  window.addEventListener('beforeunload', () => {
    if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
    if (intervalChecagemPix) clearInterval(intervalChecagemPix);
  });
});

// FLUXO DE PAGAMENTO PIX DINÂMICO
function configurarFluxoPagamentoMercadoPago() {
  const modalPagamento = document.getElementById('modalPagamento');
  const btnFecharPagamento = document.getElementById('btnFecharPagamento');
  const btnMenuPagamento = document.getElementById('menuItemPagamentos');
  const cardPix = document.getElementById('metodoPixCard');
  const cardDinheiro = document.getElementById('metodoDinheiroCard');
  const areaPixMP = document.getElementById('areaPixMercadoPago');
  const btnCopiarPix = document.getElementById('btnCopiarPix');
  const inputChavePix = document.getElementById('chavePixInput');

  function fecharModalPgto() {
    if (modalPagamento) modalPagamento.style.display = 'none';
    if (intervalChecagemPix) {
      clearInterval(intervalChecagemPix);
      intervalChecagemPix = null;
    }
  }

  btnFecharPagamento?.addEventListener('click', fecharModalPgto);

  btnMenuPagamento?.addEventListener('click', (e) => {
    e.preventDefault();
    fecharDrawer();
    if (modalPagamento) modalPagamento.style.display = 'flex';
  });

  cardPix?.addEventListener('click', () => {
    cardPix.classList.add('active-method');
    cardDinheiro?.classList.remove('active-method');
    if (areaPixMP) areaPixMP.style.display = 'block';

    abrirPromptParada({
      titulo: '💳 Recarga Pix Mercado Pago',
      placeholder: 'Valor em R$ (Ex: 15.00)',
      onConfirmar: async (valDigitado) => {
        const valorFinal = parseFloat(valDigitado.replace(',', '.'));
        if (!valorFinal || valorFinal <= 0) {
          notificar('Informe um valor numérico válido para a recarga.', 'alerta');
          return;
        }
        await requisitarPixMercadoPago(valorFinal);
      }
    });
  });

  cardDinheiro?.addEventListener('click', () => {
    cardDinheiro.classList.add('active-method');
    cardPix?.classList.remove('active-method');
    if (areaPixMP) areaPixMP.style.display = 'none';
    if (intervalChecagemPix) {
      clearInterval(intervalChecagemPix);
      intervalChecagemPix = null;
    }
    notificar('Modo presencial ativo (Dinheiro ou Maquininha com o condutor).', 'info');
  });

  btnCopiarPix?.addEventListener('click', () => {
    if (inputChavePix && inputChavePix.value) {
      inputChavePix.select();
      navigator.clipboard.writeText(inputChavePix.value);
      notificar('Chave Pix Copia e Cola copiada!', 'sucesso');
      btnCopiarPix.textContent = 'Copiado!';
      setTimeout(() => { btnCopiarPix.textContent = 'Copiar'; }, 2000);
    }
  });
}

async function requisitarPixMercadoPago(valor) {
  const token = localStorage.getItem('huby_token');
  const areaPixMP = document.getElementById('areaPixMercadoPago');
  const imgQrCode = document.getElementById('imgPixQrCode');
  const inputChavePix = document.getElementById('chavePixInput');
  const txtStatus = document.getElementById('statusPagamentoPixTexto');

  if (txtStatus) {
    txtStatus.textContent = '🔄 Gerando QR Code oficial no Mercado Pago...';
    txtStatus.style.color = '#38BDF8';
  }

  try {
    const res = await fetch(`${API_URL}/api/carteira/pix/gerar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ valor, pedidoId: estadoCliente.pedidoAtivoId || null })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao gerar cobrança Pix.');

    if (areaPixMP) areaPixMP.style.display = 'block';
    if (imgQrCode && data.qrCodeUrl) imgQrCode.src = data.qrCodeUrl;
    if (inputChavePix && data.copiaCola) inputChavePix.value = data.copiaCola;

    if (txtStatus) {
      txtStatus.textContent = `⏳ Pix de R$ ${Number(valor).toFixed(2).replace('.', ',')} aguardando liquidação...`;
      txtStatus.style.color = '#F59E0B';
    }

    iniciarMonitoramentoPix(data.txid, valor);

  } catch (err) {
    if (txtStatus) {
      txtStatus.textContent = `❌ ${err.message}`;
      txtStatus.style.color = '#EF4444';
    }
    notificar(err.message, 'erro');
  }
}

function iniciarMonitoramentoPix(txid, valor) {
  if (intervalChecagemPix) clearInterval(intervalChecagemPix);
  const token = localStorage.getItem('huby_token');
  const txtStatus = document.getElementById('statusPagamentoPixTexto');

  intervalChecagemPix = setInterval(async () => {
    try {
      const res = await fetch(`${API_URL}/api/carteira/pix/status/${txid}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return;
      const statusData = await res.json();

      if (statusData.status === 'pago') {
        clearInterval(intervalChecagemPix);
        intervalChecagemPix = null;

        if (txtStatus) {
          txtStatus.textContent = `✅ Pagamento de R$ ${Number(valor).toFixed(2).replace('.', ',')} aprovado!`;
          txtStatus.style.color = '#10B981';
        }

        notificar(`Pagamento de R$ ${Number(valor).toFixed(2).replace('.', ',')} aprovado com sucesso!`, 'sucesso');

        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
          sonsHUBy.tocarMetaBatida();
        }

        await carregarSaldoCarteiraCliente();

        setTimeout(() => {
          const modalPagamento = document.getElementById('modalPagamento');
          if (modalPagamento) modalPagamento.style.display = 'none';
        }, 2200);
      }
    } catch (e) { }
  }, 3000);
}

function exibirModalPixCorridaCliente(pix) {
  document.getElementById('modalPixCorridaAtivaCliente')?.remove();

  const modalHTML = `
    <div id="modalPixCorridaAtivaCliente" style="position:fixed;inset:0;background:rgba(9,13,22,0.92);backdrop-filter:blur(10px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#111726;border:1.5px solid rgba(139,92,246,0.5);border-radius:20px;max-width:370px;width:100%;padding:22px;text-align:center;box-shadow:0 12px 35px rgba(0,0,0,0.8);color:#FFF;">
        <div style="display:inline-block;padding:5px 12px;border-radius:20px;background:rgba(139,92,246,0.2);color:#A78BFA;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
          📱 Pagamento da Corrida
        </div>
        <h3 style="margin:4px 0 2px;font-size:17px;font-weight:900;color:#FFF;">Pague via Pix</h3>
        <p style="color:#94A3B8;font-size:12px;margin:0 0 12px;">Escaneie o QR Code ou use a chave Copia e Cola no app do seu banco</p>
        <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:10px;margin-bottom:14px;">
          <small style="color:#94A3B8;font-size:10px;font-weight:800;text-transform:uppercase;display:block;">Valor Total</small>
          <div style="color:#10B981;font-size:24px;font-weight:900;">R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}</div>
        </div>
        <div style="background:#FFF;padding:12px;border-radius:14px;display:inline-block;box-shadow:0 6px 20px rgba(0,0,0,0.5);">
          <img src="data:image/png;base64,${pix.qr_code_base64}" alt="QR Code Pix" style="width:190px;height:190px;display:block;object-fit:contain;">
        </div>
        <div style="margin-top:14px;">
          <input type="text" id="inputPixCopiaColaCliente" readonly value="${pix.qr_code || ''}" 
            style="width:100%;background:#080C14;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:#94A3B8;font-size:11px;font-family:monospace;outline:none;text-align:center;margin-bottom:8px;">
          <button type="button" id="btnCopiarPixCorridaCliente"
            style="width:100%;background:#8B5CF6;border:none;color:#FFF;padding:12px;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.2s;">
            📋 Copiar Código Pix
          </button>
        </div>
        <div style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#F59E0B;animation:pulse 1.5s infinite;"></span>
          <small style="color:#94A3B8;font-size:11px;font-weight:700;">Aguardando liquidação no banco...</small>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const btnCopiar = document.getElementById('btnCopiarPixCorridaCliente');
  btnCopiar?.addEventListener('click', () => {
    if (pix.qr_code) {
      navigator.clipboard.writeText(pix.qr_code);
      notificar('Código Pix copiado!', 'sucesso');
      btnCopiar.textContent = '✅ Código Pix Copiado!';
      btnCopiar.style.background = '#10B981';
      setTimeout(() => {
        btnCopiar.textContent = '📋 Copiar Código Pix';
        btnCopiar.style.background = '#8B5CF6';
      }, 2500);
    }
  });
}

function conectarSocketEPollingCliente() {
  const token = localStorage.getItem('huby_token');
  const socket = window.io ? window.io(API_URL, {
    auth: { token: token || '' },
    transports: ['websocket', 'polling']
  }) : null;

  if (socket) {
    socket.on('tarifas_atualizadas', (novasTarifas) => {
      aplicarObjetoTarifas(novasTarifas);
      sincronizarPrecosDaRotaAtual();
    });

    socket.on('patrocinadores_atualizados', () => {
      carregarBannersPatrocinadores(false);
    });

    socket.on('corrida_aceita', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarSucessoAceite) {
          sonsHUBy.tocarSucessoAceite();
        }
        alertaProximidadeEmitido = false;
        alternarModoVisualViagemAtiva(true);
        renderizarMotoristaChegando({ id: data.pedidoId || pedidoAtivo, ...data.motorista });
      }
    });

    socket.on('motorista_chegou_local', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data?.pedidoId) === String(pedidoAtivo)) {
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarAlertaChamada) {
          sonsHUBy.tocarAlertaChamada();
        }
        notificar('📍 O seu motorista acabou de chegar ao local de embarque!', 'sucesso');
        const lblStatus = document.getElementById('lblStatusTextoPassageiro');
        if (lblStatus) {
          lblStatus.textContent = '📍 O MOTORISTA CHEGOU! DIRIJA-SE AO VEÍCULO';
          lblStatus.style.color = '#10B981';
        }
      }
    });

    socket.on('passageiro_a_bordo', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        alternarModoVisualViagemAtiva(true);
        atualizarParaViagemEmAndamento();
      }
    });

    socket.on('corrida_cancelada', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo) return;
      if (String(data?.pedidoId) === String(pedidoAtivo)) {
        if (estadoCliente.intervalPolling) {
          clearInterval(estadoCliente.intervalPolling);
          estadoCliente.intervalPolling = null;
        }
        resetarPainelCliente();
        if (data?.canceladoPor && data.canceladoPor !== 'cliente') {
          notificar('A corrida foi cancelada pelo motorista parceiro.', 'alerta');
        }
      }
    });

    const processarMovimentoCarro = (pos) => {
      if (estadoCliente.hubyMapa && estadoCliente.hubyMapa.map && pos.lat && pos.lng) {
        criarOuAtualizarVeiculoMapa(
          estadoCliente.hubyMapa.map,
          pos.lat,
          pos.lng,
          pos.heading || 0,
          estadoCliente.categoriaSelecionada || 'carro'
        );
      }

      const coordsEmbarque = estadoCliente.rotaAtual?.origemCoords || estadoCliente.coordsOrigem;
      if (coordsEmbarque && !alertaProximidadeEmitido && pos.lat && pos.lng) {
        const dist = calcularDistanciaMetros(pos.lat, pos.lng, coordsEmbarque[0], coordsEmbarque[1]);
        if (dist <= 200) {
          alertaProximidadeEmitido = true;
          if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarAlertaChamada) {
            sonsHUBy.tocarAlertaChamada();
          }
          notificar('Motorista está a menos de 200 metros!', 'info');
          const lblStatus = document.getElementById('lblStatusTextoPassageiro');
          if (lblStatus) {
            lblStatus.textContent = '⚡ MOTORISTA ESTÁ CHEGANDO (MENOS DE 200M)!';
            lblStatus.style.color = '#10B981';
          }
        }
      }
    };

    socket.on('posicao_motorista', processarMovimentoCarro);
    socket.on('posicao_motorista_atualizada', processarMovimentoCarro);

    socket.onAny((evento, dados) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (pedidoAtivo && evento === `exibir_pix_corrida_${pedidoAtivo}`) {
        exibirModalPixCorridaCliente(dados);
      }
      if (pedidoAtivo && evento === `corrida_finalizada_${pedidoAtivo}`) {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente({ pedidoId: pedidoAtivo, ...dados });
      }
    });

    socket.on('corrida_finalizada', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente(data);
      }
    });
  }

  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  estadoCliente.intervalPolling = setInterval(async () => {
    const pedidoId = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
    if (!pedidoId) return;

    const tokenAtual = localStorage.getItem('huby_token');

    try {
      const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/status`, {
        headers: {
          'Content-Type': 'application/json',
          ...(tokenAtual ? { 'Authorization': `Bearer ${tokenAtual}` } : {})
        }
      });

      if (res.status === 401 || res.status === 404) {
        clearInterval(estadoCliente.intervalPolling);
        estadoCliente.intervalPolling = null;
        resetarPainelCliente();
        return;
      }

      if (!res.ok) return;
      const p = await res.json();

      if (p.status === 'a_caminho' || p.status === 'aceito' || p.status === 'em_andamento' || p.status === 'chegou_local') {
        alternarModoVisualViagemAtiva(true);
        renderizarMotoristaChegando({
          id: p.id || pedidoId,
          nome: p.motorista_nome,
          telefone: p.motorista_telefone,
          veiculo: p.motorista_veiculo,
          placa: p.motorista_placa,
          cor: p.veiculo_cor,
          foto: p.motorista_foto,
          avaliacao: p.motorista_avaliacao,
          aceita_dinheiro: p.aceita_dinheiro,
          aceita_cartao: p.aceita_cartao,
          aceita_pix: p.aceita_pix
        });
      } else if (p.status === 'em_viagem') {
        alternarModoVisualViagemAtiva(true);
        atualizarParaViagemEmAndamento();
      } else if (p.status === 'concluido') {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente({ pedidoId });
      } else if (p.status === 'cancelado') {
        clearInterval(estadoCliente.intervalPolling);
        estadoCliente.intervalPolling = null;
        resetarPainelCliente();
        if (p.cancelado_por && p.cancelado_por !== 'cliente') {
          notificar('A corrida foi cancelada pelo motorista parceiro.', 'alerta');
        }
      }
    } catch (e) { }
  }, 3500);
}

function renderizarMotoristaChegando(mot = {}) {
  let painel = document.getElementById('painelMotoristaAceitou');
  if (!painel) painel = document.getElementById('cardStatusViagemPassageiro');
  if (!painel) return;

  const pedidoId = mot.id || estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  const nome = escaparHTML(mot.nome || 'Motorista Parceiro');
  const veiculo = escaparHTML(mot.veiculo || 'Veículo');
  const placa = escaparHTML((mot.placa || 'ABC1D23').toUpperCase());
  const cor = escaparHTML(mot.cor || 'Prata');
  const foto = mot.foto || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80';
  const nota = Number(mot.avaliacao || 5.0).toFixed(1);
  const telefone = mot.telefone || '';

  const aceitaDinheiro = mot.aceita_dinheiro !== false;
  const aceitaCartao = mot.aceita_cartao !== false;
  const aceitaPix = mot.aceita_pix !== false;

  const badgesHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:8px 10px;background:rgba(255,255,255,0.04);border-radius:10px;font-size:11px;color:#94A3B8;flex-wrap:wrap;">
      <span style="font-weight:700;color:#CBD5E1;">Formas aceitas:</span>
      ${aceitaDinheiro ? '<span style="background:rgba(16,185,129,0.15);color:#10B981;padding:2px 8px;border-radius:6px;font-weight:700;">💵 Dinheiro</span>' : ''}
      ${aceitaCartao ? '<span style="background:rgba(56,189,248,0.15);color:#38BDF8;padding:2px 8px;border-radius:6px;font-weight:700;">💳 Maquininha</span>' : ''}
      ${aceitaPix ? '<span style="background:rgba(168,85,247,0.15);color:#A855F7;padding:2px 8px;border-radius:6px;font-weight:700;">📱 Pix</span>' : ''}
    </div>
  `;

  painel.style.display = 'block';
  painel.innerHTML = `
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(56, 189, 248, 0.12); border: 1.5px solid rgba(56, 189, 248, 0.35); padding: 12px; border-radius: 14px;">
      <div style="color: #38BDF8; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;" id="lblStatusTextoPassageiro">
        🚘 Motorista a caminho!
      </div>
      <div style="color: #FFF; font-size: 18px; font-weight: 900; margin-top: 2px;">
        Chegando para o seu embarque
      </div>
    </div>

    <div class="driver-card-accepted" style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
      <div class="driver-card-top" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${foto}" alt="${nome}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid #10B981;">
          <div>
            <h4 style="margin: 0; color: #FFF; font-size: 15px; font-weight: 800;">${nome}</h4>
            <div style="color: #F59E0B; font-weight: 800; font-size: 12px; margin-top: 2px;">
              ⭐ ${nota} <span style="color: #94A3B8; font-weight: 500;">• Motorista Parceiro</span>
            </div>
          </div>
        </div>

        <div style="text-align: right;">
          <strong style="color: #FFF; font-size: 13px; display: block;">${veiculo}</strong>
          <small style="color: #94A3B8; font-size: 11px; display: block; margin-bottom: 3px;">Cor: ${cor}</small>
          <div style="display: inline-block; border: 1.5px solid #FFF; border-radius: 4px; background: #FFF; color: #000; font-family: monospace; font-size: 11px; font-weight: 900; padding: 1px 6px;">
            <span style="color:#003399;">BR</span> ${placa}
          </div>
        </div>
      </div>

      ${badgesHTML}

      <div class="driver-card-actions" style="display: grid; grid-template-columns: ${telefone ? '1fr 1.5fr' : '1fr'}; gap: 8px; margin-top: 10px;">
        ${telefone ? `
          <a href="tel:${telefone}" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #FFF; font-weight: 800; padding: 10px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
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

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) {
    btnChatFlutuante.classList.add('chat-visivel');
    btnChatFlutuante.style.setProperty('display', 'flex', 'important');
  }

  configurarChatCliente(pedidoId);
}

function atualizarParaViagemEmAndamento() {
  const lblStatus = document.getElementById('lblStatusTextoPassageiro');
  const boxCronometro = document.getElementById('boxCronometroChegada');

  if (lblStatus) lblStatus.textContent = '🚀 Em viagem ao destino!';
  if (boxCronometro) {
    boxCronometro.style.background = 'rgba(16, 185, 129, 0.12)';
    boxCronometro.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    const subtitulo = boxCronometro.querySelector('div:last-child');
    if (subtitulo) subtitulo.textContent = 'Aproveite a sua viagem com segurança';
  }
}

function finalizarViagemCliente(data) {
  if (estadoCliente.intervalPolling) {
    clearInterval(estadoCliente.intervalPolling);
    estadoCliente.intervalPolling = null;
  }

  const pedidoFinalizadoId = data?.pedidoId || estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  if (pedidoFinalizadoId) {
    estadoCliente.corridaParaAvaliarId = pedidoFinalizadoId;
    localStorage.setItem('huby_ultima_corrida_id', pedidoFinalizadoId);
  }

  encerrarMonitoramentoChatCliente();

  const painel = document.getElementById('painelMotoristaAceitou');
  if (painel) {
    painel.style.display = 'none';
    painel.innerHTML = '';
  }

  localStorage.removeItem('huby_pedido_ativo_id');
  estadoCliente.pedidoAtivoId = null;

  alternarModoVisualViagemAtiva(false);

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) {
    btnChatFlutuante.classList.remove('chat-visivel');
    btnChatFlutuante.style.setProperty('display', 'none', 'important');
  }

  if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
    sonsHUBy.tocarMetaBatida();
  }

  const modalAvaliacao = document.getElementById('modalAvaliacao');
  if (modalAvaliacao) {
    modalAvaliacao.style.display = 'flex';
  } else {
    notificar('Viagem concluída com sucesso! Obrigado por viajar com a HUBy.', 'sucesso');
    setTimeout(() => location.reload(), 1500);
  }
}

window.abrirSuporteCorrida = async (pedidoId = null) => {
  const mensagem = prompt('Conte-nos o que aconteceu. A nossa equipa vai analisar o seu caso:');

  if (!mensagem || mensagem.trim() === '') {
    return;
  }

  const token = localStorage.getItem('huby_token');
  if (!token) {
    alert('A sua sessão expirou. Faça login novamente.');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/suporte/chamado`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pedido_id: pedidoId,
        assunto: 'Problema na Viagem',
        mensagem: mensagem.trim()
      })
    });

    const data = await res.json();

    if (res.ok) {
      alert('✅ O seu relato foi enviado para a central HUBy. A nossa equipa vai analisar e entrar em contacto!');
    } else {
      alert('❌ Erro: ' + (data.erro || 'Não foi possível enviar o relato.'));
    }
  } catch (err) {
    alert('❌ Erro de ligação ao contactar o suporte.');
  }
};

// ============================================================================
// SISTEMA DE PUBLICIDADE: POP-UP DE ENTRADA (COM X) + VITRINE DE PARCEIROS
// ============================================================================
function formatarUrlContatoPatrocinador(raw) {
  const limpo = String(raw || '').trim();
  if (!limpo) return '#';
  if (limpo.startsWith('http://') || limpo.startsWith('https://')) return limpo;
  const digitos = limpo.replace(/\D/g, '');
  if (digitos.length >= 10) {
    const ddi = digitos.startsWith('55') ? digitos : `55${digitos}`;
    return `https://wa.me/${ddi}?text=${encodeURIComponent('Olá! Vi o anúncio de vocês no aplicativo HUBy e quero aproveitar a oferta!')}`;
  }
  return '#';
}

function registrarInteracaoBanner(id, tipo = 'view') {
  if (!id) return;
  fetch(`${API_URL}/api/patrocinadores/${id}/interacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo })
  }).catch(() => {});
}

async function carregarBannersPatrocinadores(exibirPopupEntrada = true) {
  try {
    const res = await fetch(`${API_URL}/api/patrocinadores/ativos?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const lista = await res.json();
    cachePatrocinadoresAtivos = Array.isArray(lista) ? lista : [];

    renderizarVitrineParceirosCliente();

    const corridaAtiva = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
    if (exibirPopupEntrada && !corridaAtiva) {
      const candidatosPopup = cachePatrocinadoresAtivos.filter(p => p.exibir_popup !== false);
      if (candidatosPopup.length > 0) {
        const idx = Math.floor(Math.random() * candidatosPopup.length);
        abrirPopupPatrocinadorDestaque(candidatosPopup[idx]);
      }
    }
  } catch (e) {}
}

function abrirPopupPatrocinadorDestaque(p) {
  const modal = document.getElementById('modalPopupPatrocinador');
  if (!modal || !p) return;

  const elImg = document.getElementById('popupSponsorImg');
  const elEmpresa = document.getElementById('popupSponsorEmpresa');
  const elTitulo = document.getElementById('popupSponsorTitulo');
  const elDesc = document.getElementById('popupSponsorDesc');

  if (elImg) elImg.src = p.imagem_base64;
  if (elEmpresa) elEmpresa.textContent = p.nome_empresa || 'Parceiro Oficial';
  if (elTitulo) elTitulo.textContent = p.titulo_oferta || '';
  if (elDesc) elDesc.textContent = p.descricao || '';

  const cupomBox = document.getElementById('popupSponsorCupomBox');
  const cupomTxt = document.getElementById('popupSponsorCupomCodigo');
  if (p.cupom_codigo && cupomBox && cupomTxt) {
    cupomTxt.textContent = p.cupom_codigo;
    cupomBox.style.display = 'block';
  } else if (cupomBox) {
    cupomBox.style.display = 'none';
  }

  const btnAcao = document.getElementById('btnAcaoPopupPatrocinador');
  if (btnAcao) {
    const urlDestino = formatarUrlContatoPatrocinador(p.whatsapp_link);
    btnAcao.href = urlDestino;
    btnAcao.style.display = urlDestino === '#' ? 'none' : 'flex';
    btnAcao.onclick = () => {
      registrarInteracaoBanner(p.id, 'clique');
      modal.style.display = 'none';
    };
  }

  modal.style.display = 'flex';
  registrarInteracaoBanner(p.id, 'view');
}

function renderizarVitrineParceirosCliente() {
  const container = document.getElementById('listaCardsParceirosCliente');
  if (!container) return;

  const filtrados = categoriaFiltroParceiro === 'todos'
    ? cachePatrocinadoresAtivos
    : cachePatrocinadoresAtivos.filter(p => String(p.categoria).toLowerCase() === categoriaFiltroParceiro);

  if (filtrados.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: #94A3B8;">
        <div style="font-size: 32px; margin-bottom: 8px;">✨</div>
        <strong style="color: #FFF; display: block; margin-bottom: 4px;">Novos parceiros em breve!</strong>
        <small>Em breve novas ofertas exclusivas nesta categoria.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = filtrados.map(p => {
    const urlContato = formatarUrlContatoPatrocinador(p.whatsapp_link);
    return `
      <div style="background: #0F1624; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.45);">
        <div style="position: relative; width: 100%; height: 175px; background: #090D16;">
          <img src="${p.imagem_base64}" alt="${escaparHTML(p.nome_empresa)}" style="width: 100%; height: 100%; object-fit: cover; display: block;">
          ${p.cupom_codigo ? `
            <span style="position: absolute; bottom: 10px; right: 10px; background: rgba(9,13,22,0.92); border: 1px dashed #10B981; color: #10B981; font-size: 11px; font-weight: 900; padding: 4px 10px; border-radius: 8px;">
              🏷️ CUPOM: ${escaparHTML(p.cupom_codigo)}
            </span>
          ` : ''}
        </div>
        <div style="padding: 14px;">
          <small style="color: #10B981; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;">
            ${escaparHTML(p.nome_empresa)}
          </small>
          <h4 style="margin: 3px 0 6px; font-size: 15px; font-weight: 900; color: #FFF;">
            ${escaparHTML(p.titulo_oferta)}
          </h4>
          ${p.descricao ? `<p style="margin: 0 0 12px; font-size: 12px; color: #94A3B8; line-height: 1.4;">${escaparHTML(p.descricao)}</p>` : ''}
          ${urlContato !== '#' ? `
            <a href="${urlContato}" target="_blank" rel="noopener"
              onclick="window.registrarCliqueParceiroVitrine(${p.id})"
              style="width: 100%; background: rgba(16, 185, 129, 0.16); border: 1px solid #10B981; color: #10B981; font-weight: 900; padding: 10px; border-radius: 10px; font-size: 12px; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 6px;">
              📲 Falar com Parceiro / Ver Oferta
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.registrarCliqueParceiroVitrine = (id) => {
  registrarInteracaoBanner(id, 'clique');
};

function inicializarPatrocinadoresCliente() {
  const modalPopup = document.getElementById('modalPopupPatrocinador');
  const modalVitrine = document.getElementById('modalVitrineParceiros');

  document.getElementById('btnFecharPopupPatrocinador')?.addEventListener('click', () => {
    if (modalPopup) modalPopup.style.display = 'none';
  });

  modalPopup?.addEventListener('click', (e) => {
    if (e.target === modalPopup) modalPopup.style.display = 'none';
  });

  const abrirVitrine = (e) => {
    if (e) e.preventDefault();
    fecharDrawer();
    if (modalPopup) modalPopup.style.display = 'none';
    renderizarVitrineParceirosCliente();
    if (modalVitrine) modalVitrine.style.display = 'flex';
  };

  document.getElementById('btnNavParceiros')?.addEventListener('click', abrirVitrine);
  document.getElementById('menuItemParceiros')?.addEventListener('click', abrirVitrine);
  document.getElementById('btnVerTodosParceirosPopup')?.addEventListener('click', abrirVitrine);

  document.getElementById('btnFecharVitrineParceiros')?.addEventListener('click', () => {
    if (modalVitrine) modalVitrine.style.display = 'none';
  });

  document.querySelectorAll('#filtrosVitrineParceiros .partner-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filtrosVitrineParceiros .partner-filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      categoriaFiltroParceiro = btn.getAttribute('data-cat') || 'todos';
      renderizarVitrineParceirosCliente();
    });
  });

  carregarBannersPatrocinadores(true);
}