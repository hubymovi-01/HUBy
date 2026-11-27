// js/cliente/cliente-pedidos.js - Gestão de Pedidos, Agendamentos e Radar HUBy Sincronizado
// Preço: o servidor é quem manda (rota /api/pedidos/cotacao). O app só mostra uma estimativa
// instantânea com a MESMA fórmula enquanto a cotação oficial não chega.
import { API_URL, calcularPreco, cotarCorrida, chaveCategoriaPreco, sincronizarTarifasServidor, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { encerrarMonitoramentoChatCliente } from './cliente-chat.js';
import { estadoRecursos, limparCupomAplicado } from './cliente-recursos.js';
import { notificar, confirmarAcao } from '../util/alertas-huby.js';
import { pararRastreioCorrida } from './cliente-rastreio.js';

const ORIGEM_PADRAO = [-8.3582, -42.2476];

// Só aceita foto em https ou imagem base64 (evita injetar código pelo campo da foto)
export function fotoSegura(url, padrao) {
  const u = String(url || '').trim();
  if (/^https:\/\/[^\s"'<>]+$/.test(u) || /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u)) {
    return u;
  }
  return padrao;
}

function formatarReais(valor) {
  return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

// ============================================================================
// DADOS DA ROTA ATUAL (usados na cotação e no pedido)
// ============================================================================
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function obterCoordsOrigem() {
  const mapa = estadoCliente.hubyMapa;
  return estadoCliente.coordsOrigem ||
    mapa?.coordsOrigem ||
    (mapa?.posicaoAtual ? [mapa.posicaoAtual.lat, mapa.posicaoAtual.lng] : null) ||
    ORIGEM_PADRAO;
}

export function extrairDistanciaKm(rota = estadoCliente.rotaAtual) {
  if (estadoCliente.distanciaTotalComParadas) {
    const total = Number(estadoCliente.distanciaTotalComParadas);
    if (Number.isFinite(total) && total > 0) return total;
  }
  if (rota) {
    const bruta = Number(
      rota.distanciaKm ??
      rota.distancia_km ??
      rota.distancia ??
      (rota.distance ? rota.distance / 1000 : 0)
    );
    if (Number.isFinite(bruta) && bruta > 0) return bruta;
  }
  if (estadoCliente.coordsDestino) {
    const origem = obterCoordsOrigem();
    const m = calcularDistanciaMetros(origem[0], origem[1], estadoCliente.coordsDestino[0], estadoCliente.coordsDestino[1]);
    return Math.max(0.2, Number(((m / 1000) * 1.3).toFixed(2)));
  }
  return 0;
}

function extrairDuracaoMin(rota = estadoCliente.rotaAtual) {
  const total = Number(estadoCliente.duracaoTotalComParadas);
  if (Number.isFinite(total) && total > 0) return total;
  const d = Number(rota?.duracaoMin ?? rota?.duracao_min ?? (rota?.duration ? rota.duration / 60 : 0));
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function paradasReaisCliente() {
  return (estadoCliente.paradasIntermediarias || []).filter((p) => p && !p.nota);
}

// Tudo o que muda o preço. Retorna null se ainda não há destino.
export function obterParametrosCotacao() {
  if (!estadoCliente.coordsDestino) return null;
  const distanciaKm = extrairDistanciaKm();
  if (!(distanciaKm > 0)) return null;

  const origem = obterCoordsOrigem().map(Number);
  const destino = estadoCliente.coordsDestino.map(Number);
  if (![...origem, ...destino].every(Number.isFinite)) return null;

  return {
    origem,
    destino,
    distanciaKm: Number(distanciaKm.toFixed(2)),
    duracaoMin: Math.round(extrairDuracaoMin()),
    qtdParadas: paradasReaisCliente().length,
    adicionais: 0,
    cupom: estadoRecursos?.cupomAplicado || null
  };
}

function chaveDosParametros(p) {
  if (!p) return '';
  return JSON.stringify([
    p.origem.map((n) => n.toFixed(5)),
    p.destino.map((n) => n.toFixed(5)),
    p.distanciaKm, p.duracaoMin, p.qtdParadas, p.adicionais, p.cupom || ''
  ]);
}

// ============================================================================
// COTAÇÃO OFICIAL DO SERVIDOR
// ============================================================================
let sequenciaCotacao = 0;

// Busca o preço oficial de carro, moto e entrega para a rota atual
export async function atualizarCotacaoServidor() {
  const params = obterParametrosCotacao();
  if (!params) {
    estadoCliente.cotacaoServidor = null;
    return null;
  }

  const minhaVez = ++sequenciaCotacao;
  const chave = chaveDosParametros(params);
  const dados = await cotarCorrida(params);

  // Se o passageiro mudou a rota enquanto esperava, ignora a resposta antiga
  if (minhaVez !== sequenciaCotacao) return null;
  if (!dados) return null;

  estadoCliente.cotacaoServidor = { chave, dados, em: Date.now() };
  return dados;
}

// Cotação oficial que ainda vale para a rota atual (ou null)
export function cotacaoValida() {
  const c = estadoCliente.cotacaoServidor;
  if (!c) return null;
  return c.chave === chaveDosParametros(obterParametrosCotacao()) ? c.dados : null;
}

// Preço de uma categoria: oficial do servidor se houver, senão a estimativa local
export function precoCategoria(categoria) {
  const params = obterParametrosCotacao();
  if (!params) return null;

  const chave = chaveCategoriaPreco(categoria);
  const oficial = cotacaoValida()?.categorias?.[chave];
  if (oficial) {
    return {
      valor: Number(oficial.valorFinal),
      valorSemDesconto: Number(oficial.valorSemDesconto),
      desconto: Number(oficial.descontoTotal || 0),
      oficial: true,
      distanciaKm: params.distanciaKm
    };
  }

  const est = calcularPreco(categoria, params.distanciaKm, params.duracaoMin, { qtdParadas: params.qtdParadas });
  return {
    valor: est.valorTotal,
    valorSemDesconto: est.valorTotal,
    desconto: 0,
    oficial: false,
    distanciaKm: params.distanciaKm
  };
}

function avisarPrecosAtualizados() {
  try {
    window.dispatchEvent(new CustomEvent('huby_precos_atualizados'));
  } catch (e) {}
}

// ============================================================================
// BOTÃO PRINCIPAL E RESUMO
// ============================================================================
export function atualizarBotaoChamar() {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn) return;

  const painelAceito = document.getElementById('painelMotoristaAceitou');
  if (painelAceito && painelAceito.style.display === 'block') {
    btn.style.setProperty('display', 'none', 'important');
    return;
  }

  if (estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id')) {
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.background = '#ef4444';
    const spanText = btn.querySelector('.btn-text');
    if (spanText) spanText.textContent = 'Cancelar Chamada';
    else btn.textContent = 'Cancelar Chamada';
    return;
  }

  btn.style.setProperty('display', 'flex', 'important');
  btn.style.background = '';

  const ehAgendado = Boolean(estadoRecursos?.dataAgendada);
  const labels = {
    carro: ehAgendado ? 'Agendar HUBy Carro' : 'Confirmar HUBy Carro',
    moto: ehAgendado ? 'Agendar HUBy Moto' : 'Confirmar HUBy Moto',
    entrega: ehAgendado ? 'Agendar HUBy Flash' : 'Confirmar HUBy Flash'
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

  const preco = (estadoCliente.coordsDestino && estadoCliente.rotaAtual)
    ? precoCategoria(estadoCliente.categoriaSelecionada || 'carro')
    : null;

  if (!preco) {
    if (lblPreco) lblPreco.textContent = '--';
    if (lblDistancia) lblDistancia.textContent = '-- km';
    estadoCliente.precoFinalCalculado = null;
    return;
  }

  estadoCliente.precoFinalCalculado = preco.valor;
  estadoCliente.rotaAtual.preco = preco.valor;
  estadoCliente.rotaAtual.valorTotal = preco.valor;

  if (lblPreco) lblPreco.textContent = formatarReais(preco.valor);
  if (lblDistancia) {
    lblDistancia.textContent = preco.distanciaKm > 0 ? `${preco.distanciaKm.toFixed(1)} km` : '-- km';
  }
}

// ============================================================================
// ENVIAR O PEDIDO
// ============================================================================
export async function submeterPedido(valorConfirmado = null) {
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

  const btn = document.getElementById('btnPedirHuby');
  const travarBotao = (texto) => {
    if (!btn) return;
    btn.disabled = true;
    const span = btn.querySelector('.btn-text');
    if (span) span.textContent = texto;
  };
  const liberarBotao = () => {
    if (!btn) return;
    btn.disabled = false;
    atualizarBotaoChamar();
  };

  travarBotao('Conferindo o preço...');

  // Pega o preço oficial antes de chamar (o passageiro confirma o que vai pagar)
  if (valorConfirmado === null) {
    await sincronizarTarifasServidor();
    await atualizarCotacaoServidor();
    atualizarResumoValores();
    avisarPrecosAtualizados();
  }

  const params = obterParametrosCotacao();
  const categoria = estadoCliente.categoriaSelecionada || 'carro';
  const precoMostrado = precoCategoria(categoria);
  if (!params || !precoMostrado) {
    liberarBotao();
    notificar('Não foi possível calcular a rota. Escolha o destino novamente.', 'alerta');
    return;
  }

  const valorEsperado = valorConfirmado !== null ? Number(valorConfirmado) : precoMostrado.valor;

  const clienteNome = localStorage.getItem('huby_user_name') || 'Passageiro HUBy';
  const novoId = 'ped_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

  const cupomCodigo = estadoRecursos?.cupomAplicado || null;
  const observacaoTexto = (estadoRecursos?.notaMotorista || '').trim();
  const agendadoPara = estadoRecursos?.dataAgendada || null;

  const [latOrigNum, lngOrigNum] = params.origem;
  const [latDestNum, lngDestNum] = params.destino;

  const inputOrigemEl = document.getElementById('inputOrigemLocal');
  const textoOrigem = (estadoCliente.enderecoOrigem || inputOrigemEl?.value || '').trim();
  const nomeOrigem = textoOrigem || `Local atual (${latOrigNum.toFixed(4)}, ${lngOrigNum.toFixed(4)})`;

  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const inputDestinoEl = document.getElementById('inputPesquisaLocal');
  let nomeDestino = (inputDestinoEl?.value?.trim() || txtDestino?.textContent || '').trim();
  if (!nomeDestino || nomeDestino === 'Selecione no mapa ou pesquise') {
    nomeDestino = `Destino (${latDestNum.toFixed(4)}, ${lngDestNum.toFixed(4)})`;
  }

  if (categoria === 'entrega') {
    const recebedor = document.getElementById('inputRecebedor')?.value || 'Não informado';
    const tipoItemEl = document.getElementById('selectTipoItem');
    const tipoItem = tipoItemEl && tipoItemEl.value !== '' ? tipoItemEl.options[tipoItemEl.selectedIndex].text : 'Encomenda';
    nomeDestino += ` | 📦 Recebedor: ${recebedor} | 🏷️ ${tipoItem}`;
  }

  // Só as paradas reais vão na lista (observação, cupom e agendamento vão em campos próprios)
  const paradasReais = paradasReaisCliente().map((p) => ({
    endereco: String(p.endereco || '').slice(0, 200),
    lat: p.lat ?? null,
    lng: p.lng ?? null
  }));

  const nomesCategoria = { carro: 'HUBy Carro', moto: 'HUBy Moto', entrega: 'HUBy Flash' };

  // O servidor calcula o valor. O app só informa quanto MOSTROU, para o servidor avisar se mudou.
  const payload = {
    id: novoId,
    cliente_nome: clienteNome,
    tipo: categoria,
    sub_tipo_id: categoria,
    sub_tipo_label: nomesCategoria[categoria] || 'HUBy Carro',
    origem_endereco: nomeOrigem,
    destino_endereco: nomeDestino,
    origem_lat: latOrigNum,
    origem_lng: lngOrigNum,
    destino_lat: latDestNum,
    destino_lng: lngDestNum,
    distancia_km: params.distanciaKm,
    duracao_min: params.duracaoMin,
    valor_esperado: valorEsperado,
    metodo_pagamento: 'livre',
    cupom_codigo: cupomCodigo,
    observacao: observacaoTexto,
    agendado_para: agendadoPara,
    paradas: paradasReais
  };

  try {
    travarBotao(agendadoPara ? 'Registrando agendamento...' : 'Solicitando motorista...');

    const resp = await fetch(`${API_URL}/api/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const dadosResposta = await resp.json().catch(() => ({}));

    // O preço subiu entre a tela e o pedido (ex.: tarifa dinâmica): pergunta ao passageiro
    if (resp.status === 409 && dadosResposta.codigo === 'PRECO_ALTERADO') {
      if (dadosResposta.cotacao) {
        estadoCliente.cotacaoServidor = { chave: chaveDosParametros(params), dados: dadosResposta.cotacao, em: Date.now() };
      }
      atualizarResumoValores();
      avisarPrecosAtualizados();

      const novoValor = Number(dadosResposta.valorAtual || 0);
      const aceitou = await confirmarAcao({
        titulo: 'O preço mudou',
        mensagem: `O valor desta corrida agora é ${formatarReais(novoValor)}. Deseja chamar mesmo assim?`,
        textoConfirmar: 'Chamar',
        textoCancelar: 'Voltar'
      });

      liberarBotao();
      if (aceitou) await submeterPedido(novoValor);
      return;
    }

    if (!resp.ok) {
      if (resp.status === 401) {
        localStorage.removeItem('huby_token');
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      throw new Error(dadosResposta.erro || 'Falha ao registrar pedido.');
    }

    const idPedido = dadosResposta.id || novoId;
    const valorFinal = Number(dadosResposta.valorFinal ?? valorEsperado);

    // Cupom que não pôde ser usado (esgotou ou expirou): avisa e tira da tela
    if (dadosResposta.cupomRecusado) {
      notificar(`Cupom não aplicado: ${dadosResposta.cupomRecusado}`, 'alerta', 6000);
      limparCupomAplicado();
    } else if (dadosResposta.cupomAplicado) {
      limparCupomAplicado(true);
    }

    if (agendadoPara) {
      const listaAgendadosCliente = JSON.parse(localStorage.getItem('huby_meus_agendamentos') || '[]');
      listaAgendadosCliente.push({
        id: idPedido,
        origem: nomeOrigem,
        destino: nomeDestino,
        agendado_para: agendadoPara,
        valor: valorFinal,
        notificado_hora: false,
        aceito_por: null
      });
      localStorage.setItem('huby_meus_agendamentos', JSON.stringify(listaAgendadosCliente.slice(-20)));

      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      const horaFmt = new Date(agendadoPara).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      notificar(`✅ Corrida agendada para ${horaFmt} por ${formatarReais(valorFinal)}. Avisaremos quando um motorista aceitar.`, 'sucesso', 6000);

      estadoRecursos.dataAgendada = null;
      const badgeAg = document.getElementById('txtAgendamentoBadge');
      const btnLimparAg = document.getElementById('btnLimparAgendamento');
      const btnAg = document.getElementById('btnAgendarViagem');
      if (badgeAg) badgeAg.style.display = 'none';
      if (btnLimparAg) btnLimparAg.style.display = 'none';
      if (btnAg) {
        btnAg.style.background = '';
        btnAg.style.color = '';
        btnAg.style.borderColor = '';
      }

      liberarBotao();
      return;
    }

    estadoCliente.pedidoAtivoId = idPedido;
    localStorage.setItem('huby_pedido_ativo_id', idPedido);

    mostrarAguardandoMotorista();

    // Quem acompanha a corrida (socket, consulta de status e mapa ao vivo) é o app-cliente.js
    try {
      window.dispatchEvent(new CustomEvent('huby_corrida_iniciada', { detail: { pedidoId: idPedido } }));
    } catch (e) {}
  } catch (err) {
    notificar(err.message, 'erro');
    if (err.message.includes('Sessão expirada')) {
      window.location.replace('./login.html?perfil=cliente');
      return;
    }
    liberarBotao();
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
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.background = '#ef4444';
    const spanText = btn.querySelector('.btn-text');
    if (spanText) spanText.textContent = 'Cancelar Chamada';
    else btn.textContent = 'Cancelar Chamada';
  }
}

// ============================================================================
// CANCELAR A CORRIDA (PASSAGEIRO)
// Antes do aceite: cancela direto. Depois do aceite: pede confirmação.
// A tela só é limpa DEPOIS que o servidor confirma o cancelamento.
// ============================================================================
let cancelandoAgora = false;

function motoristaJaAceitou() {
  const painel = document.getElementById('painelMotoristaAceitou');
  return Boolean(painel && painel.style.display === 'block');
}

// Mostra a janela de confirmação do index.html (ou a confirmação padrão, se ela não existir)
async function confirmarCancelamentoComMotorista() {
  const modal = document.getElementById('modalRegrasCancelamentoCliente');
  const btnManter = document.getElementById('btnDesistirCancelamento');
  const btnConfirmar = document.getElementById('btnConfirmarCancelamento');

  if (!modal || !btnManter || !btnConfirmar) {
    return confirmarAcao({
      titulo: 'Cancelar corrida?',
      mensagem: 'O motorista já está a caminho. Deseja mesmo cancelar?',
      textoConfirmar: 'Sim, cancelar',
      textoCancelar: 'Manter corrida',
      perigo: true
    });
  }

  const aviso = document.getElementById('avisoTempoDecorrido');
  if (aviso) aviso.style.display = 'none';
  modal.style.display = 'flex';

  return new Promise((resolve) => {
    const fechar = (resultado) => {
      modal.style.display = 'none';
      btnManter.removeEventListener('click', aoManter);
      btnConfirmar.removeEventListener('click', aoConfirmar);
      resolve(resultado);
    };
    const aoManter = () => fechar(false);
    const aoConfirmar = () => fechar(true);
    btnManter.addEventListener('click', aoManter);
    btnConfirmar.addEventListener('click', aoConfirmar);
  });
}

export async function cancelarBusca() {
  if (cancelandoAgora) return false;

  const pedidoId = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  if (!pedidoId) {
    resetarPainelCliente();
    return true;
  }

  const comMotorista = motoristaJaAceitou();
  if (comMotorista) {
    const confirmou = await confirmarCancelamentoComMotorista();
    if (!confirmou) return false;
  }

  const token = localStorage.getItem('huby_token');
  const btn = document.getElementById('btnPedirHuby');
  const btnCancelarCartao = document.getElementById('btnCancelarCorridaPassageiro');
  cancelandoAgora = true;
  if (btn) btn.disabled = true;
  if (btnCancelarCartao) {
    btnCancelarCartao.disabled = true;
    btnCancelarCartao.textContent = 'Cancelando...';
  }

  let cancelouNoServidor = false;
  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(pedidoId)}/cancelar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        motivo: comMotorista ? 'Cancelado pelo passageiro (motorista a caminho)' : 'Cancelado pelo passageiro durante a busca'
      })
    });
    const dados = await resp.json().catch(() => ({}));

    // Corrida já encerrada no servidor (cancelada ou concluída antes): só limpa a tela
    const jaEncerrada = resp.status === 400 && /encerrad/i.test(String(dados.erro || ''));

    if (!resp.ok && !jaEncerrada) {
      notificar(dados.erro || 'Não foi possível cancelar agora. Tente novamente.', 'erro', 5000);
    } else {
      cancelouNoServidor = true;
    }
  } catch (err) {
    notificar('Sem conexão. A corrida NÃO foi cancelada. Tente novamente.', 'erro', 5000);
  }

  cancelandoAgora = false;
  if (btn) btn.disabled = false;
  const btnCartao = document.getElementById('btnCancelarCorridaPassageiro');
  if (btnCartao) {
    btnCartao.disabled = false;
    btnCartao.textContent = 'Cancelar corrida';
  }

  if (!cancelouNoServidor) return false;

  // Só aqui, com o cancelamento confirmado, a tela volta ao início
  estadoCliente.horaAceiteMotorista = null;
  localStorage.removeItem('huby_hora_aceite_motorista');
  if (estadoCliente.intervalPolling) {
    clearInterval(estadoCliente.intervalPolling);
    estadoCliente.intervalPolling = null;
  }

  try {
    resetarPainelCliente();
  } catch (e) {
    console.warn('Aviso ao limpar a tela:', e);
  }
  notificar('Corrida cancelada.', 'info');
  return true;
}

export function resetarPainelCliente() {
  pararRastreioCorrida();
  estadoCliente.pedidoAtivoId = null;
  estadoCliente.rotaAtual = null;
  estadoCliente.coordsDestino = null;
  estadoCliente.motoristaAceitouTocado = false;
  estadoCliente.horaAceiteMotorista = null;
  estadoCliente.cotacaoServidor = null;
  
  // Limpa os caches de viagem para não dar conflito na próxima chamada
  localStorage.removeItem('huby_pedido_ativo_id');
  localStorage.removeItem('huby_hora_aceite_motorista');

  if (estadoCliente.cronometroChegada) {
    clearInterval(estadoCliente.cronometroChegada);
    estadoCliente.cronometroChegada = null;
  }
  const divTempo = document.getElementById('boxCronometroChegada');
  if (divTempo) divTempo.remove();

  estadoCliente.hubyMapa?.limparRota?.();
  estadoCliente.hubyMapa?.limparDestino?.();

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
  if (btnChatFlutuante) btnChatFlutuante.style.setProperty('display', 'none', 'important');

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

  if (txtDestino) txtDestino.textContent = 'Selecione no mapa ou pesquise';
  if (txtDist) txtDist.textContent = '-- km';
  if (txtPreco) txtPreco.textContent = '--';

  if (btn) {
    btn.disabled = false;
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.background = '';
    atualizarBotaoChamar();
  }

  encerrarMonitoramentoChatCliente();

  // Avisa o app-cliente.js para mostrar de novo as opções de pedido
  try {
    window.dispatchEvent(new CustomEvent('huby_painel_resetado'));
  } catch (e) {}
}