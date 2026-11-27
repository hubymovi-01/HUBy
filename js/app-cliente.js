// js/app-cliente.js - Orquestrador Principal HUBy Passageiro (Chamada Livre + Modais Modernos + Sincronização Total)
import { API_URL, sonsHUBy, sincronizarTarifasServidor, aplicarObjetoTarifas } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=8';
import { estadoCliente } from './cliente/cliente-estado.js';
import { carregarSaldoCarteiraCliente, configurarDrawerMenu, verificarAcessoAdminMenu, fecharDrawer, carregarEExibirHistoricoModal } from './cliente/cliente-ui-menu.js';
import { configurarModalAvaliacao, configurarBotoesGorjeta } from './cliente/cliente-avaliacao.js';
import {
  atualizarBotaoChamar,
  atualizarResumoValores,
  submeterPedido,
  cancelarBusca,
  resetarPainelCliente,
  atualizarCotacaoServidor,
  cotacaoValida,
  precoCategoria,
  extrairDistanciaKm,
  fotoSegura
} from './cliente/cliente-pedidos.js';
import { configurarChatCliente, encerrarMonitoramentoChatCliente } from './cliente/cliente-chat.js';
import { notificar } from './util/alertas-huby.js';
import { abrirPromptParada } from './cliente-ui.js';
import {
  configurarSeletorPagamentoRapido,
  configurarNotaMotorista,
  configurarCupomDesconto,
  configurarAgendamentoCorrida,
  conferirCupomNaCotacao,
  estadoRecursos
} from './cliente/cliente-recursos.js';
import { iniciarRastreioCorrida, definirFaseRastreio, pararRastreioCorrida } from './cliente/cliente-rastreio.js';

let intervalChecagemPix = null;
let alertaProximidadeEmitido = false;

// Acompanhamento da corrida aceita
let socketCliente = null;
let cartaoRenderizadoPara = null;   // id da corrida cujo cartão do motorista já está na tela
let faseCartao = null;              // 'buscando' | 'viagem'
let motoristaChegou = false;

const STATUS_INDO_BUSCAR = ['aceito', 'a_caminho'];
const STATUS_NO_LOCAL = ['chegou_local', 'aguardando_passageiro', 'no_local', 'motorista_no_local'];
const STATUS_EM_VIAGEM = ['em_viagem', 'em_andamento'];
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

// ============================================================================
// PREÇOS NA TELA
// 1) mostra na hora a estimativa local (mesma fórmula do servidor)
// 2) busca o preço oficial no servidor e troca pelos valores definitivos
// ============================================================================
async function sincronizarPrecosDaRotaAtual() {
  if (!estadoCliente.coordsDestino || !(extrairDistanciaKm() > 0)) {
    atualizarValoresCardsPro();
    atualizarAlertaDinamica(1);
    return;
  }

  atualizarResumoValores();
  atualizarValoresCardsPro();

  const dados = await atualizarCotacaoServidor();
  if (!dados) return;

  conferirCupomNaCotacao(dados);
  atualizarAlertaDinamica(Number(dados.multiplicador || 1));
  atualizarResumoValores();
  atualizarValoresCardsPro();
}

function atualizarAlertaDinamica(multiplicador) {
  const alerta = document.getElementById('alertaAltaDemanda');
  const txtMultiplicador = document.getElementById('txtMultiplicadorDemanda');
  if (!alerta || !txtMultiplicador) return;

  if (multiplicador > 1.0) {
    alerta.style.display = 'flex';
    txtMultiplicador.textContent = `Alta procura agora. Os preços estão multiplicados por x${Number(multiplicador).toFixed(1).replace('.', ',')}.`;
  } else {
    alerta.style.display = 'none';
  }
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
    document.querySelector('.dock-quick-actions-row'),
    document.getElementById('alertaAltaDemanda')
  ];

  elementosParaEsconder.forEach(el => {
    if (!el) return;
    if (emViagem) {
      el.style.display = 'none';
      return;
    }
    // Ao voltar, alguns blocos só aparecem quando fazem sentido
    if (el.id === 'cardStatusViagem' || el.id === 'alertaAltaDemanda') {
      el.style.display = 'none';
    } else if (el.id === 'blocoDetalhesEntrega') {
      el.style.display = estadoCliente.categoriaSelecionada === 'entrega' ? 'block' : 'none';
    } else {
      el.style.display = '';
    }
  });

  if (!emViagem) {
    sincronizarPrecosDaRotaAtual();
  }

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

function atualizarValoresCardsPro() {
  const rotulos = {
    carro: document.getElementById('priceEstCarro'),
    moto: document.getElementById('priceEstMoto'),
    entrega: document.getElementById('priceEstEntrega')
  };
  const lblPrincipal = document.getElementById('txtPrecoEstimado');

  const temRota = Boolean(estadoCliente.coordsDestino && estadoCliente.rotaAtual);
  const oficial = Boolean(cotacaoValida());

  Object.entries(rotulos).forEach(([cat, el]) => {
    if (!el) return;
    const preco = temRota ? precoCategoria(cat) : null;
    // "≈" enquanto o valor ainda é estimativa; some quando chega o preço oficial
    el.textContent = preco
      ? `${oficial ? '' : '≈ '}R$ ${preco.valor.toFixed(2).replace('.', ',')}`
      : '--';
  });

  const atual = temRota ? precoCategoria(estadoCliente.categoriaSelecionada || 'carro') : null;
  if (lblPrincipal) {
    lblPrincipal.textContent = atual ? `R$ ${atual.valor.toFixed(2).replace('.', ',')}` : '--';
  }
  if (atual && estadoCliente.rotaAtual) {
    estadoCliente.rotaAtual.preco = atual.valor;
    estadoCliente.rotaAtual.valorTotal = atual.valor;
  }
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

        const idParada = `par_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        estadoCliente.paradasIntermediarias.push({
          id: idParada,
          endereco: String(enderecoParada).slice(0, 200),
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
            const index = estadoCliente.paradasIntermediarias.findIndex(p => p.id === idParada);
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

function configurarLimpezaDestino() {
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');
  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const containerParadas = document.getElementById('containerParadasIntermediarias');
  const alerta = document.getElementById('alertaAltaDemanda');

  btnLimpar?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (inputPesquisa) {
      inputPesquisa.value = '';
      inputPesquisa.focus();
    }
    btnLimpar.style.display = 'none';
    if (listaResultados) {
      listaResultados.innerHTML = '';
      listaResultados.style.display = 'none';
    }
    if (alerta) alerta.style.display = 'none';

    estadoCliente.coordsDestino = null;
    estadoCliente.rotaAtual = null;
    if (estadoCliente.paradasIntermediarias) {
      estadoCliente.paradasIntermediarias = [];
    }

    if (estadoCliente.hubyMapa) {
      estadoCliente.hubyMapa.limparRota?.();
      estadoCliente.hubyMapa.limparDestino?.();
    }

    if (txtDestino) txtDestino.textContent = 'Selecione no mapa ou pesquise';
    if (containerParadas) containerParadas.innerHTML = '';
    estadoCliente.cotacaoServidor = null;
    atualizarValoresCardsPro();
    atualizarResumoValores();
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
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&limit=1&countrycodes=br&accept-language=pt-BR`);
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
      const mapaInstancia = estadoCliente.hubyMapa.map;

      function onToqueMapa(e) {
        const lat = e.lngLat ? e.lngLat.lat : e.latlng?.lat;
        const lng = e.lngLat ? e.lngLat.lng : e.latlng?.lng;
        if (lat === undefined || lng === undefined) return;

        const coords = [lat, lng];
        const nomeFormatado = `${labelAlvo} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        localStorage.setItem(`huby_endereco_${tipoAlvo}`, nomeFormatado);
        localStorage.setItem(`huby_coords_${tipoAlvo}`, JSON.stringify(coords));

        const descElem = document.getElementById(tipoAlvo === 'casa' ? 'txtMenuCasaDesc' : 'txtMenuTrabalhoDesc');
        if (descElem) descElem.textContent = nomeFormatado;

        notificar(`Localização de "${labelAlvo}" salva!`, 'sucesso');
      }

      mapaInstancia.once('click', onToqueMapa);
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
    const btnLimpar = document.getElementById('btnLimparPesquisa');

    if (txtDestino) txtDestino.textContent = enderecoSalvo;
    if (inputPesquisa) inputPesquisa.value = enderecoSalvo;
    if (btnLimpar) btnLimpar.style.display = 'inline-block';

    if (estadoCliente.hubyMapa) {
      const origem = estadoCliente.coordsOrigem ||
        estadoCliente.hubyMapa.coordsOrigem ||
        (estadoCliente.hubyMapa.posicaoAtual ? [estadoCliente.hubyMapa.posicaoAtual.lat, estadoCliente.hubyMapa.posicaoAtual.lng] : null) ||
        [-8.3582, -42.2476];
      const rota = await estadoCliente.hubyMapa.calcularRota(origem, coords, '#10B981', true);
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

async function iniciarSubmissaoPedidoFinal() {
  if (estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id')) {
    await cancelarBusca();
    return;
  }
  if (!estadoCliente.coordsDestino || !estadoCliente.rotaAtual) {
    notificar('Selecione um destino no mapa antes de confirmar.', 'alerta');
    return;
  }

  estadoCliente.rotaAtual.forma_pagamento = 'livre';
  estadoCliente.rotaAtual.metodo_pgto = 'livre';

  if (estadoRecursos?.cupomAplicado) {
    estadoCliente.rotaAtual.cupomCodigo = estadoRecursos.cupomAplicado;
  }

  if (estadoRecursos?.dataAgendada) {
    estadoCliente.rotaAtual.agendadoPara = estadoRecursos.dataAgendada;
  }

  if (estadoCliente.enderecoOrigem) {
    estadoCliente.rotaAtual.origemEndereco = estadoCliente.enderecoOrigem;
  }

  estadoCliente.rotaAtual.subTipoId = estadoCliente.categoriaSelecionada || 'carro';
  estadoCliente.rotaAtual.subTipoLabel = `HUBy ${String(estadoCliente.categoriaSelecionada).charAt(0).toUpperCase() + String(estadoCliente.categoriaSelecionada).slice(1)}`;

  await submeterPedido();
}

document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('hubySplash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 350);
  }

  await sincronizarTarifasServidor();
  await carregarSaldoCarteiraCliente();
  atualizarValoresCardsPro();

  // Quando o servidor devolve um preço novo (ex.: "o preço mudou"), redesenha os cards
  window.addEventListener('huby_precos_atualizados', () => atualizarValoresCardsPro());

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
      const btnLimpar = document.getElementById('btnLimparPesquisa');
      const listaResultados = document.getElementById('listaResultadosPesquisa');

      const textoDestino = `Destino (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;

      if (txtDestino) txtDestino.textContent = textoDestino;
      if (inputPesquisa) inputPesquisa.value = textoDestino;
      if (btnLimpar) btnLimpar.style.display = 'inline-block';
      if (listaResultados) {
        listaResultados.innerHTML = '';
        listaResultados.style.display = 'none';
      }

      sincronizarPrecosDaRotaAtual();
    });

    estadoCliente.hubyMapa.obterGPS?.((pos) => {
      if (pos && pos.lat && pos.lng && !estadoCliente.enderecoOrigem) {
        estadoCliente.coordsOrigem = [pos.lat, pos.lng];
      }
    });

    setTimeout(() => {
      estadoCliente.hubyMapa?.invalidarTamanho?.();
    }, 250);
  } catch (err) {
    console.warn('Aviso no mapa:', err);
  }

  const aplicarOrigemPersonalizada = async (coordsOrigemNova, nomeOrigem) => {
    estadoCliente.coordsOrigem = coordsOrigemNova;
    estadoCliente.enderecoOrigem = nomeOrigem;

    const inputOrigem = document.getElementById('inputOrigemLocal');
    const btnResetGPS = document.getElementById('btnUsarMeuGPSOrigem');

    if (inputOrigem) inputOrigem.value = nomeOrigem;
    if (btnResetGPS) btnResetGPS.style.display = 'inline-block';

    if (estadoCliente.coordsDestino && estadoCliente.hubyMapa) {
      const rota = await estadoCliente.hubyMapa.calcularRota(coordsOrigemNova, estadoCliente.coordsDestino, '#10B981', true);
      estadoCliente.rotaAtual = rota;
      sincronizarPrecosDaRotaAtual();
    }
  };

  const restaurarOrigemMeuGPS = () => {
    estadoCliente.enderecoOrigem = null;
    const inputOrigem = document.getElementById('inputOrigemLocal');
    const btnResetGPS = document.getElementById('btnUsarMeuGPSOrigem');

    if (inputOrigem) inputOrigem.value = '';
    if (btnResetGPS) btnResetGPS.style.display = 'none';

    estadoCliente.hubyMapa?.obterGPS(async (pos) => {
      if (pos?.lat && pos?.lng) {
        estadoCliente.coordsOrigem = [pos.lat, pos.lng];
        if (estadoCliente.coordsDestino) {
          const rota = await estadoCliente.hubyMapa.calcularRota([pos.lat, pos.lng], estadoCliente.coordsDestino, '#10B981', true);
          estadoCliente.rotaAtual = rota;
          sincronizarPrecosDaRotaAtual();
        }
      }
    });
  };

  document.getElementById('btnUsarMeuGPSOrigem')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    restaurarOrigemMeuGPS();
    notificar('Partida redefinida para sua localização GPS atual.', 'info');
  });

  if (estadoCliente.hubyMapa) {
    configurarPesquisaLocal(
      estadoCliente.hubyMapa,
      async (rota, coords, nomeCurto) => {
        await sincronizarTarifasServidor();
        estadoCliente.rotaAtual = rota;
        estadoCliente.coordsDestino = coords;

        const txtDestino = document.getElementById('txtDestinoSelecionado');
        const inputPesquisa = document.getElementById('inputPesquisaLocal');
        const btnLimpar = document.getElementById('btnLimparPesquisa');
        const listaResultados = document.getElementById('listaResultadosPesquisa');

        if (txtDestino) txtDestino.textContent = nomeCurto;
        if (inputPesquisa) inputPesquisa.value = nomeCurto;
        if (btnLimpar) btnLimpar.style.display = 'inline-block';
        if (listaResultados) {
          listaResultados.innerHTML = '';
          listaResultados.style.display = 'none';
        }

        sincronizarPrecosDaRotaAtual();
      },
      aplicarOrigemPersonalizada
    );
  }

  configurarParadasIntermediariasSemPrompt();
  configurarLimpezaDestino();
  configurarLocaisFavoritosMenu();

  configurarSeletorPagamentoRapido();
  configurarCupomDesconto(() => sincronizarPrecosDaRotaAtual());
  configurarNotaMotorista();
  configurarAgendamentoCorrida(() => atualizarBotaoChamar());

  // Sentinela de notificações de agendamentos do passageiro
  setInterval(() => {
    const lista = JSON.parse(localStorage.getItem('huby_meus_agendamentos') || '[]');
    if (!lista.length) return;
    const agora = Date.now();
    let alterou = false;

    for (const item of lista) {
      const ts = new Date(item.agendado_para).getTime();
      const diffMin = (ts - agora) / 60000;
      if (!item.notificado_hora && diffMin <= 10 && diffMin >= -30) {
        item.notificado_hora = true;
        alterou = true;
        if (sonsHUBy?.tocarAlertaChamada) sonsHUBy.tocarAlertaChamada();
        notificar(`⏰ Sua corrida agendada para ${item.destino} está disponível agora!`, 'sucesso', 9000);
      }
    }

    if (alterou) {
      localStorage.setItem('huby_meus_agendamentos', JSON.stringify(lista));
    }
  }, 15000);

  const processarDestinoIA = async (e) => {
    const dados = e.detail || {};
    const nome = dados.nome || 'Destino Selecionado';

    let coordsDestino = null;
    if (Array.isArray(dados.coords) && dados.coords.length === 2) {
      coordsDestino = [parseFloat(dados.coords[0]), parseFloat(dados.coords[1])];
    } else if (dados.lat && dados.lng) {
      coordsDestino = [parseFloat(dados.lat), parseFloat(dados.lng)];
    }

    if (!coordsDestino || isNaN(coordsDestino[0]) || isNaN(coordsDestino[1])) return;

    await sincronizarTarifasServidor();
    estadoCliente.coordsDestino = coordsDestino;

    const txtDestino = document.getElementById('txtDestinoSelecionado');
    const inputPesquisa = document.getElementById('inputPesquisaLocal');
    const btnLimpar = document.getElementById('btnLimparPesquisa');
    const listaResultados = document.getElementById('listaResultadosPesquisa');

    if (txtDestino) txtDestino.textContent = nome;
    if (inputPesquisa) {
      inputPesquisa.value = nome;
      inputPesquisa.blur();
    }
    if (btnLimpar) btnLimpar.style.display = 'inline-block';
    if (listaResultados) {
      listaResultados.innerHTML = '';
      listaResultados.style.display = 'none';
    }

    if (estadoCliente.hubyMapa) {
      const origem = estadoCliente.coordsOrigem ||
        estadoCliente.hubyMapa.coordsOrigem ||
        (estadoCliente.hubyMapa.posicaoAtual ? [estadoCliente.hubyMapa.posicaoAtual.lat, estadoCliente.hubyMapa.posicaoAtual.lng] : null) ||
        [-8.3582, -42.2476];

      estadoCliente.coordsOrigem = origem;

      const rota = await estadoCliente.hubyMapa.calcularRota(origem, coordsDestino, '#10B981', true);
      estadoCliente.rotaAtual = rota;
      sincronizarPrecosDaRotaAtual();
    }
  };

  window.removeEventListener('huby_local_selecionado_ia', processarDestinoIA);
  window.addEventListener('huby_local_selecionado_ia', processarDestinoIA);

  const btnGPS = document.getElementById('btnLocalizarGPS');
  if (btnGPS) {
    btnGPS.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      restaurarOrigemMeuGPS();
    });
  }

  configurarDrawerMenu();
  verificarAcessoAdminMenu();

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

      atualizarBotaoChamar();

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

  // Corrida nova criada (cliente-pedidos.js avisa): começa a acompanhar
  window.addEventListener('huby_corrida_iniciada', () => {
    limparEstadoCorridaNaTela(false);
    iniciarPollingCorrida();
  });

  // Painel voltou ao início (corrida cancelada/encerrada): mostra de novo as opções de pedido
  window.addEventListener('huby_painel_resetado', () => {
    limparEstadoCorridaNaTela(true);
  });

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

// FLUXO DE PAGAMENTO PIX DINÂMICO (CARTEIRA / CORRIDA)
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
    } catch (e) {}
  }, 3000);
}

function exibirModalPixCorridaCliente(pixBruto) {
  document.getElementById('modalPixCorridaAtivaCliente')?.remove();

  // Só aceita dados no formato esperado (QR em base64 e código Pix em texto)
  const pix = {
    valor: Number(pixBruto?.valor || 0),
    qr_code: String(pixBruto?.qr_code || ''),
    qr_code_base64: String(pixBruto?.qr_code_base64 || '').replace(/[^A-Za-z0-9+/=]/g, '')
  };

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
          <input type="text" id="inputPixCopiaColaCliente" readonly value="${escaparHTML(pix.qr_code)}" 
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

// ============================================================================
// ACOMPANHAMENTO DA CORRIDA (SOCKET + CONSULTA DE STATUS + MAPA AO VIVO)
// ============================================================================
function pedidoAtivoAtual() {
  return estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id') || null;
}

function ehDaMinhaCorrida(pedidoId) {
  const ativo = pedidoAtivoAtual();
  return Boolean(ativo && pedidoId && String(pedidoId) === String(ativo));
}

function coordsDe(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && !(a === 0 && b === 0) ? [a, b] : null;
}

function conectarSocketEPollingCliente() {
  const token = localStorage.getItem('huby_token');
  socketCliente = window.io ? window.io(API_URL, {
    auth: { token: token || '' },
    transports: ['websocket', 'polling']
  }) : null;

  const socket = socketCliente;

  if (socket) {
    socket.on('tarifas_atualizadas', (novasTarifas) => {
      aplicarObjetoTarifas(novasTarifas);
      if (!pedidoAtivoAtual()) sincronizarPrecosDaRotaAtual();
    });

    socket.on('patrocinadores_atualizados', () => {
      carregarBannersPatrocinadores(false);
    });

    // Só reage a avisos da SUA corrida
    socket.on('corrida_aceita', (data) => {
      if (!ehDaMinhaCorrida(data?.pedidoId)) return;
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      estadoCliente.horaAceiteMotorista = Date.now();
      localStorage.setItem('huby_hora_aceite_motorista', String(estadoCliente.horaAceiteMotorista));
      mostrarCorridaAceita({ id: data.pedidoId, status: 'a_caminho', ...(data.motorista || {}) });
    });

    socket.on('motorista_chegou_local', (data) => {
      if (ehDaMinhaCorrida(data?.pedidoId)) marcarMotoristaChegou();
    });

    socket.on('status_corrida_atualizado', (data) => {
      if (!ehDaMinhaCorrida(data?.pedidoId)) return;
      if (STATUS_NO_LOCAL.includes(String(data?.status || '').toLowerCase())) marcarMotoristaChegou();
    });

    socket.on('passageiro_a_bordo', (data) => {
      if (ehDaMinhaCorrida(data?.pedidoId)) iniciarFaseViagem();
    });

    socket.on('corrida_cancelada', (data) => {
      if (ehDaMinhaCorrida(data?.pedidoId)) encerrarPorCancelamento(data?.canceladoPor);
    });

    socket.onAny((evento, dados) => {
      const pedidoAtivo = pedidoAtivoAtual();
      if (pedidoAtivo && evento === `exibir_pix_corrida_${pedidoAtivo}`) {
        exibirModalPixCorridaCliente(dados);
      }
      if (pedidoAtivo && evento === `corrida_finalizada_${pedidoAtivo}`) {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente({ pedidoId: pedidoAtivo, ...dados });
      }
    });

    socket.on('corrida_finalizada', (data) => {
      if (!ehDaMinhaCorrida(data?.pedidoId)) return;
      document.getElementById('modalPixCorridaAtivaCliente')?.remove();
      finalizarViagemCliente(data);
    });
  }

  iniciarPollingCorrida();
}

// Consulta o status a cada 3,5 s (garante a tela certa mesmo se algum aviso do socket se perder)
function iniciarPollingCorrida() {
  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  estadoCliente.intervalPolling = setInterval(consultarStatusCorrida, 3500);
  consultarStatusCorrida();
}

function pararPollingCorrida() {
  if (estadoCliente.intervalPolling) {
    clearInterval(estadoCliente.intervalPolling);
    estadoCliente.intervalPolling = null;
  }
}

async function consultarStatusCorrida() {
  const pedidoId = pedidoAtivoAtual();
  if (!pedidoId) return;

  const tokenAtual = localStorage.getItem('huby_token');

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(pedidoId)}/status`, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(tokenAtual ? { Authorization: `Bearer ${tokenAtual}` } : {})
      }
    });

    if (res.status === 401 || res.status === 404) {
      pararPollingCorrida();
      resetarPainelCliente();
      return;
    }
    if (!res.ok) return;

    const p = await res.json();
    if (!ehDaMinhaCorrida(p.id || pedidoId)) return;
    const status = String(p.status || '').toLowerCase();

    const dadosCartao = {
      id: p.id || pedidoId,
      status,
      nome: p.motorista_nome,
      telefone: p.motorista_telefone,
      veiculo: p.motorista_veiculo,
      placa: p.motorista_placa,
      cor: p.veiculo_cor,
      foto: p.motorista_foto,
      avaliacao: p.motorista_avaliacao,
      aceita_dinheiro: p.aceita_dinheiro,
      aceita_cartao: p.aceita_cartao,
      aceita_pix: p.aceita_pix,
      origem_lat: p.origem_lat,
      origem_lng: p.origem_lng,
      destino_lat: p.destino_lat,
      destino_lng: p.destino_lng
    };

    if (STATUS_INDO_BUSCAR.includes(status) || STATUS_NO_LOCAL.includes(status)) {
      mostrarCorridaAceita(dadosCartao);
      if (STATUS_NO_LOCAL.includes(status)) marcarMotoristaChegou();
    } else if (STATUS_EM_VIAGEM.includes(status)) {
      mostrarCorridaAceita(dadosCartao);
      iniciarFaseViagem();
    } else if (status === 'concluido') {
      document.getElementById('modalPixCorridaAtivaCliente')?.remove();
      finalizarViagemCliente({ pedidoId });
    } else if (status === 'cancelado') {
      encerrarPorCancelamento(p.cancelado_por);
    }
  } catch (e) {}
}

// Motorista aceitou: mostra o cartão (uma vez) e liga o mapa ao vivo
function mostrarCorridaAceita(dados = {}) {
  const pedidoId = String(dados.id || pedidoAtivoAtual() || '');
  if (!pedidoId) return;

  alternarModoVisualViagemAtiva(true);

  if (cartaoRenderizadoPara !== pedidoId) {
    renderizarMotoristaChegando(dados);
    cartaoRenderizadoPara = pedidoId;
    faseCartao = 'buscando';
    motoristaChegou = false;
    alertaProximidadeEmitido = false;
  }

  const embarque = coordsDe(dados.origem_lat, dados.origem_lng)
    || estadoCliente.rotaAtual?.origemCoords
    || estadoCliente.coordsOrigem
    || null;
  const destino = coordsDe(dados.destino_lat, dados.destino_lng)
    || estadoCliente.rotaAtual?.destinoCoords
    || estadoCliente.coordsDestino
    || null;

  if (socketCliente && estadoCliente.hubyMapa && embarque) {
    iniciarRastreioCorrida({
      socket: socketCliente,
      pedidoId,
      mapa: estadoCliente.hubyMapa,
      embarque,
      destino,
      fase: STATUS_EM_VIAGEM.includes(String(dados.status || '').toLowerCase()) ? 'viagem' : 'buscando',
      categoria: estadoCliente.categoriaSelecionada || 'carro',
      aoAtualizar: atualizarEtaCartao
    });
  }
}

// Recebe do mapa ao vivo o tempo e a distância e escreve no cartão
function atualizarEtaCartao(info = {}) {
  const eta = document.getElementById('txtEtaRastreio');
  if (!eta) return;

  const km = Number.isFinite(info.distanciaKm) && info.distanciaKm > 0
    ? ` · ${info.distanciaKm.toFixed(1).replace('.', ',')} km`
    : '';

  if (info.semSinal) {
    eta.textContent = '📡 Sem sinal do motorista no momento...';
    return;
  }

  if (info.fase === 'viagem') {
    eta.textContent = info.minutos
      ? `Chegada ao destino em ${info.minutos} min${km}`
      : 'Calculando a chegada ao destino...';
    return;
  }

  if (motoristaChegou) {
    eta.textContent = 'Seu motorista está no local de embarque';
    return;
  }

  eta.textContent = info.minutos
    ? `Chega em ${info.minutos} min${km}`
    : (info.temPosicao ? 'Calculando o caminho...' : 'Localizando o motorista no mapa...');

  // Aviso de "está chegando" quando o carro fica a menos de 200 m
  if (!alertaProximidadeEmitido && Number.isFinite(info.distanciaAteAlvoM) && info.distanciaAteAlvoM <= 200) {
    alertaProximidadeEmitido = true;
    if (sonsHUBy?.tocarAlertaChamada) sonsHUBy.tocarAlertaChamada();
    notificar('Seu motorista está a menos de 200 metros!', 'info');
    const lblStatus = document.getElementById('lblStatusTextoPassageiro');
    if (lblStatus) {
      lblStatus.textContent = '⚡ Motorista chegando (menos de 200 m)';
      lblStatus.style.color = '#10B981';
    }
  }
}

function marcarMotoristaChegou() {
  if (motoristaChegou || faseCartao === 'viagem') return;
  motoristaChegou = true;

  if (sonsHUBy?.tocarAlertaChamada) sonsHUBy.tocarAlertaChamada();
  notificar('📍 Seu motorista chegou ao local de embarque!', 'sucesso');

  const lblStatus = document.getElementById('lblStatusTextoPassageiro');
  if (lblStatus) {
    lblStatus.textContent = '📍 O motorista chegou! Dirija-se ao veículo';
    lblStatus.style.color = '#10B981';
  }
  const eta = document.getElementById('txtEtaRastreio');
  if (eta) eta.textContent = 'Seu motorista está no local de embarque';
}

// Passageiro embarcou: a linha passa a ir até o destino
function iniciarFaseViagem() {
  if (faseCartao === 'viagem') return;
  faseCartao = 'viagem';
  motoristaChegou = false;
  definirFaseRastreio('viagem');
  atualizarParaViagemEmAndamento();
}

function encerrarPorCancelamento(canceladoPor) {
  pararPollingCorrida();
  resetarPainelCliente();
  if (canceladoPor && canceladoPor !== 'cliente') {
    notificar(
      canceladoPor === 'admin' ? 'A corrida foi cancelada pela central HUBy.' : 'A corrida foi cancelada pelo motorista parceiro.',
      'alerta',
      6000
    );
  }
}

// Zera o que a tela guarda da corrida (mostrarOpcoes = volta a mostrar categorias e botões)
function limparEstadoCorridaNaTela(mostrarOpcoes) {
  pararRastreioCorrida();
  cartaoRenderizadoPara = null;
  faseCartao = null;
  motoristaChegou = false;
  alertaProximidadeEmitido = false;
  if (mostrarOpcoes) alternarModoVisualViagemAtiva(false);
}

function renderizarMotoristaChegando(mot = {}) {
  let painel = document.getElementById('painelMotoristaAceitou');
  if (!painel) painel = document.getElementById('cardStatusViagemPassageiro');
  if (!painel) return;

  const pedidoId = mot.id || pedidoAtivoAtual();
  const nome = escaparHTML(mot.nome || 'Motorista Parceiro');
  const veiculo = escaparHTML(mot.veiculo || 'Veículo');
  const placa = escaparHTML(String(mot.placa || '---').toUpperCase());
  const cor = escaparHTML(mot.cor || '--');
  const foto = escaparHTML(fotoSegura(mot.foto, 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80'));
  const nota = Number(mot.avaliacao || 5.0).toFixed(1);
  const telefone = String(mot.telefone || '').replace(/[^\d+]/g, '');

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
      <div style="color: #FFF; font-size: 18px; font-weight: 900; margin-top: 2px;" id="txtEtaRastreio">
        Localizando o motorista no mapa...
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

      <button type="button" id="btnCancelarCorridaPassageiro"
        style="margin-top: 10px; width: 100%; background: transparent; border: 1px solid rgba(239, 68, 68, 0.35); color: #F87171; font-weight: 800; padding: 9px; border-radius: 10px; font-size: 12px; cursor: pointer;">
        Cancelar corrida
      </button>
    </div>
  `;

  document.getElementById('btnCancelarCorridaPassageiro')?.addEventListener('click', () => {
    cancelarBusca();
  });

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
  const eta = document.getElementById('txtEtaRastreio');

  if (lblStatus) {
    lblStatus.textContent = '🚀 Em viagem ao destino';
    lblStatus.style.color = '#10B981';
  }
  if (boxCronometro) {
    boxCronometro.style.background = 'rgba(16, 185, 129, 0.12)';
    boxCronometro.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  }
  if (eta && !/Chegada ao destino/.test(eta.textContent || '')) {
    eta.textContent = 'Calculando a chegada ao destino...';
  }

  // Depois do embarque não dá mais para cancelar pelo app
  document.getElementById('btnCancelarCorridaPassageiro')?.remove();
}

function finalizarViagemCliente(data) {
  pararPollingCorrida();
  pararRastreioCorrida();

  const pedidoFinalizadoId = data?.pedidoId || pedidoAtivoAtual();
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
  localStorage.removeItem('huby_hora_aceite_motorista');
  estadoCliente.pedidoAtivoId = null;

  cartaoRenderizadoPara = null;
  faseCartao = null;
  motoristaChegou = false;
  alertaProximidadeEmitido = false;

  alternarModoVisualViagemAtiva(false);

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) {
    btnChatFlutuante.classList.remove('chat-visivel');
    btnChatFlutuante.style.setProperty('display', 'none', 'important');
  }

  if (sonsHUBy?.tocarMetaBatida) {
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

  if (elImg) elImg.src = fotoSegura(p.imagem_base64, '');
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
          <img src="${escaparHTML(fotoSegura(p.imagem_base64, ''))}" alt="${escaparHTML(p.nome_empresa)}" style="width: 100%; height: 100%; object-fit: cover; display: block;">
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
            <a href="${escaparHTML(urlContato)}" target="_blank" rel="noopener"
              onclick="window.registrarCliqueParceiroVitrine(${Number(p.id) || 0})"
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