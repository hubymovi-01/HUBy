// js/cliente/cliente-recursos.js - Módulo de Cupom, Observação, Agendamento e Veículo 3D
// Cupons: quem valida é o SERVIDOR (tabela de cupons do painel admin). Nada de cupom escrito no app.
import { estadoCliente } from './cliente-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { atualizarResumoValores, atualizarCotacaoServidor, obterParametrosCotacao } from './cliente-pedidos.js';

export const estadoRecursos = {
  formaPagamento: 'livre',
  cupomAplicado: null,
  cupomInfo: null, // { tipo: 'porcentagem' | 'fixo', valor } vindo do servidor
  notaMotorista: '',
  dataAgendada: null,
  markerVeiculoAnimado: null
};

let callbackPrecoCupom = null;

function textoDescontoCupom(info) {
  if (!info) return '';
  const valor = Number(info.valor || 0);
  return info.tipo === 'porcentagem'
    ? `-${valor}%`
    : `-R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Mostra o cupom na tela (texto seguro, sem HTML vindo do usuário)
function pintarCupomNaTela(codigo, info) {
  const btnCupom = document.getElementById('btnAplicarCupom');
  const lblBtnCupom = document.getElementById('lblBtnCupom');
  const tagCupom = document.getElementById('tagCupomAtivo');

  if (codigo) {
    if (tagCupom) {
      tagCupom.textContent = '';
      tagCupom.append('🏷️ Cupom ');
      const forte = document.createElement('strong');
      forte.textContent = codigo;
      tagCupom.append(forte);
      const desc = textoDescontoCupom(info);
      tagCupom.append(desc ? ` aplicado (${desc})` : ' será conferido ao escolher o destino');
      tagCupom.style.display = 'block';
    }
    if (lblBtnCupom) lblBtnCupom.textContent = 'Remover';
    if (btnCupom) {
      btnCupom.style.background = 'rgba(16, 185, 129, 0.2)';
      btnCupom.style.color = '#10B981';
      btnCupom.style.borderColor = '#10B981';
    }
  } else {
    if (tagCupom) {
      tagCupom.textContent = '';
      tagCupom.style.display = 'none';
    }
    if (lblBtnCupom) lblBtnCupom.textContent = 'Cupom';
    if (btnCupom) {
      btnCupom.style.background = '';
      btnCupom.style.color = '';
      btnCupom.style.borderColor = '';
    }
  }
}

// Remove o cupom da tela e recalcula o preço (silencioso = sem aviso)
export function limparCupomAplicado(silencioso = false) {
  if (!estadoRecursos.cupomAplicado) return;
  estadoRecursos.cupomAplicado = null;
  estadoRecursos.cupomInfo = null;
  pintarCupomNaTela(null, null);
  const inputCupom = document.getElementById('inputCupomDesconto');
  if (inputCupom) inputCupom.value = '';
  atualizarResumoValores();
  if (typeof callbackPrecoCupom === 'function') callbackPrecoCupom();
  if (!silencioso) notificar('Cupom removido.', 'info');
}

// Chamado depois de cada cotação: se o servidor recusou o cupom, avisa e retira
export function conferirCupomNaCotacao(dadosCotacao) {
  if (!estadoRecursos.cupomAplicado || !dadosCotacao?.cupom) return;
  const c = dadosCotacao.cupom;
  if (String(c.codigo || '').toUpperCase() !== estadoRecursos.cupomAplicado) return;

  if (c.valido) {
    estadoRecursos.cupomInfo = { tipo: c.tipo, valor: c.valor };
    pintarCupomNaTela(estadoRecursos.cupomAplicado, estadoRecursos.cupomInfo);
  } else {
    notificar(c.motivo || 'Cupom inválido.', 'alerta');
    limparCupomAplicado(true);
  }
}

export function configurarSeletorPagamentoRapido() {
  // Chamada livre sem seletor de pagamento na tela inicial
}

// 1. OBSERVAÇÃO PARA O MOTORISTA (MODAL MODERNO)
export function configurarNotaMotorista() {
  const btnNota = document.getElementById('btnAdicionarNotaMotorista');
  const btnLimparNota = document.getElementById('btnLimparNotaMotorista');
  const badgeText = document.getElementById('txtNotaMotoristaBadge');
  const modal = document.getElementById('modalObservacaoHUBy');
  const inputObs = document.getElementById('inputObsMotoristaModal');
  const btnFechar = document.getElementById('btnFecharModalObs');
  const btnCancelar = document.getElementById('btnCancelarModalObs');
  const btnConfirmar = document.getElementById('btnConfirmarModalObs');

  if (!btnNota || !modal) return;

  const fecharModal = () => {
    modal.style.display = 'none';
  };

  btnNota.addEventListener('click', () => {
    if (inputObs) {
      inputObs.value = estadoRecursos.notaMotorista || '';
      setTimeout(() => inputObs.focus(), 80);
    }
    modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  document.querySelectorAll('.chip-obs-rapida').forEach((chip) => {
    chip.addEventListener('click', () => {
      const texto = chip.getAttribute('data-obs') || '';
      if (inputObs) {
        inputObs.value = inputObs.value.trim() ? `${inputObs.value.trim()} • ${texto}` : texto;
      }
    });
  });

  btnConfirmar?.addEventListener('click', () => {
    const msg = (inputObs?.value || '').trim().slice(0, 400);
    if (!msg) {
      notificar('Digite uma observação antes de salvar.', 'alerta');
      return;
    }

    estadoRecursos.notaMotorista = msg;
    btnNota.style.background = 'rgba(56, 189, 248, 0.2)';
    btnNota.style.color = '#38BDF8';
    btnNota.style.borderColor = '#38BDF8';

    if (badgeText) {
      badgeText.style.display = 'block';
      badgeText.textContent = '📝 Obs: ';
      const forte = document.createElement('strong');
      forte.textContent = msg;
      badgeText.append(forte);
    }
    if (btnLimparNota) btnLimparNota.style.display = 'flex';

    fecharModal();
    notificar('Observação salva e sincronizada!', 'sucesso');
  });

  btnLimparNota?.addEventListener('click', (e) => {
    e.stopPropagation();
    estadoRecursos.notaMotorista = '';
    btnNota.style.background = '';
    btnNota.style.color = '';
    btnNota.style.borderColor = '';
    if (badgeText) badgeText.style.display = 'none';
    btnLimparNota.style.display = 'none';
    notificar('Observação removida.', 'info');
  });
}

// 2. CUPOM PROMOCIONAL (MODAL MODERNO) - validado no servidor
export function configurarCupomDesconto(aoAtualizarPrecoCallback = null) {
  const btnCupom = document.getElementById('btnAplicarCupom');
  const modal = document.getElementById('modalCupomHUBy');
  const inputCupom = document.getElementById('inputCupomDesconto');
  const btnFechar = document.getElementById('btnFecharModalCupom');
  const btnCancelar = document.getElementById('btnCancelarModalCupom');
  const btnConfirmar = document.getElementById('btnConfirmarModalCupom');

  callbackPrecoCupom = aoAtualizarPrecoCallback;

  if (!btnCupom || !modal) return;

  const fecharModal = () => {
    modal.style.display = 'none';
  };

  btnCupom.addEventListener('click', () => {
    if (estadoRecursos.cupomAplicado) {
      limparCupomAplicado();
      return;
    }

    if (inputCupom) {
      inputCupom.value = '';
      setTimeout(() => inputCupom.focus(), 80);
    }
    modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  document.querySelectorAll('.chip-cupom-rapido').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (inputCupom) inputCupom.value = chip.getAttribute('data-code') || '';
    });
  });

  btnConfirmar?.addEventListener('click', async () => {
    const codigo = (inputCupom?.value || '').trim().toUpperCase().slice(0, 40);
    if (!codigo) {
      notificar('Informe o código do cupom.', 'alerta');
      return;
    }
    if (!/^[A-Z0-9_-]{2,40}$/.test(codigo)) {
      notificar('Código de cupom inválido.', 'alerta');
      return;
    }

    // Sem destino ainda: guarda o código e confere quando a rota existir
    if (!obterParametrosCotacao()) {
      estadoRecursos.cupomAplicado = codigo;
      estadoRecursos.cupomInfo = null;
      pintarCupomNaTela(codigo, null);
      fecharModal();
      notificar('Cupom guardado. Ele será conferido quando você escolher o destino.', 'info');
      return;
    }

    btnConfirmar.disabled = true;
    const textoOriginal = btnConfirmar.textContent;
    btnConfirmar.textContent = 'Conferindo...';

    const cupomAnterior = estadoRecursos.cupomAplicado;
    const infoAnterior = estadoRecursos.cupomInfo;
    estadoRecursos.cupomAplicado = codigo;

    try {
      const dados = await atualizarCotacaoServidor();

      if (!dados) {
        estadoRecursos.cupomAplicado = cupomAnterior;
        estadoRecursos.cupomInfo = infoAnterior;
        notificar('Não foi possível conferir o cupom agora. Tente de novo.', 'erro');
        return;
      }

      if (!dados.cupom?.valido) {
        estadoRecursos.cupomAplicado = cupomAnterior;
        estadoRecursos.cupomInfo = infoAnterior;
        notificar(dados.cupom?.motivo || 'Cupom inválido ou expirado.', 'alerta');
        // Recalcula sem o cupom recusado
        if (typeof callbackPrecoCupom === 'function') callbackPrecoCupom();
        return;
      }

      estadoRecursos.cupomInfo = { tipo: dados.cupom.tipo, valor: dados.cupom.valor };
      pintarCupomNaTela(codigo, estadoRecursos.cupomInfo);
      atualizarResumoValores();
      if (typeof callbackPrecoCupom === 'function') callbackPrecoCupom();
      fecharModal();
      notificar(`Cupom ${codigo} (${textoDescontoCupom(estadoRecursos.cupomInfo)}) aplicado!`, 'sucesso');
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = textoOriginal;
    }
  });
}

// 3. AGENDAMENTO DE CORRIDA (MODAL VISUAL COM DATA E HORA NATIVA)
export function configurarAgendamentoCorrida(aoAtualizarBotaoCallback = null) {
  const btnAgendar = document.getElementById('btnAgendarViagem');
  const btnLimparAgendamento = document.getElementById('btnLimparAgendamento');
  const badgeAgendamento = document.getElementById('txtAgendamentoBadge');
  const modal = document.getElementById('modalAgendamentoHUBy');
  const inputDataHora = document.getElementById('inputDataHoraAgendamento');
  const btnFechar = document.getElementById('btnFecharModalAgendamento');
  const btnCancelar = document.getElementById('btnCancelarModalAgendamento');
  const btnConfirmar = document.getElementById('btnConfirmarModalAgendamento');

  if (!btnAgendar || !modal) return;

  const formatarParaInputLocal = (dateObj) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
  };

  const fecharModal = () => {
    modal.style.display = 'none';
  };

  btnAgendar.addEventListener('click', () => {
    const padrao = new Date(Date.now() + 45 * 60 * 1000);
    if (inputDataHora) {
      inputDataHora.min = formatarParaInputLocal(new Date(Date.now() + 25 * 60 * 1000));
      inputDataHora.value = estadoRecursos.dataAgendada
        ? formatarParaInputLocal(new Date(estadoRecursos.dataAgendada))
        : formatarParaInputLocal(padrao);
    }
    modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  document.querySelectorAll('.chip-tempo-rapido').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mins = Number(chip.getAttribute('data-min') || 45);
      const alvo = new Date(Date.now() + mins * 60 * 1000);
      if (inputDataHora) inputDataHora.value = formatarParaInputLocal(alvo);
    });
  });

  document.querySelector('.chip-amanha-manha')?.addEventListener('click', () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(8, 0, 0, 0);
    if (inputDataHora) inputDataHora.value = formatarParaInputLocal(amanha);
  });

  btnConfirmar?.addEventListener('click', () => {
    const val = inputDataHora?.value;
    if (!val) {
      notificar('Selecione a data e o horário.', 'alerta');
      return;
    }

    const dtAgendada = new Date(val);
    if (isNaN(dtAgendada.getTime()) || dtAgendada.getTime() - Date.now() < 20 * 60 * 1000) {
      notificar('Escolha um horário com pelo menos 25 minutos de antecedência.', 'alerta');
      return;
    }

    estadoRecursos.dataAgendada = dtAgendada.toISOString();
    btnAgendar.style.background = 'rgba(245, 158, 11, 0.2)';
    btnAgendar.style.color = '#FBBF24';
    btnAgendar.style.borderColor = '#F59E0B';

    const formatado = dtAgendada.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (badgeAgendamento) {
      badgeAgendamento.style.display = 'block';
      badgeAgendamento.textContent = '⏰ Agendada para: ';
      const forte = document.createElement('strong');
      forte.textContent = formatado;
      badgeAgendamento.append(forte);
    }
    if (btnLimparAgendamento) btnLimparAgendamento.style.display = 'flex';
    if (typeof aoAtualizarBotaoCallback === 'function') aoAtualizarBotaoCallback();

    fecharModal();
    notificar(`Agendamento definido para ${formatado}!`, 'sucesso');
  });

  btnLimparAgendamento?.addEventListener('click', (e) => {
    e.stopPropagation();
    estadoRecursos.dataAgendada = null;
    btnAgendar.style.background = '';
    btnAgendar.style.color = '';
    btnAgendar.style.borderColor = '';
    if (badgeAgendamento) badgeAgendamento.style.display = 'none';
    btnLimparAgendamento.style.display = 'none';
    if (typeof aoAtualizarBotaoCallback === 'function') aoAtualizarBotaoCallback();
    notificar('Agendamento removido.', 'info');
  });
}

export function criarOuAtualizarVeiculoMapa(mapaInstancia, lat, lng, heading = 0, categoria = 'carro') {
  if (!mapaInstancia || !window.maplibregl) return;

  if (!estadoRecursos.markerVeiculoAnimado) {
    const el = document.createElement('div');
    el.style.cssText = 'width:38px;height:38px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.75);font-size:19px;';
    el.textContent = categoria === 'moto' ? '🏍️' : '🚗';

    estadoRecursos.markerVeiculoAnimado = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(mapaInstancia);
  } else {
    estadoRecursos.markerVeiculoAnimado.setLngLat([lng, lat]);
  }
}