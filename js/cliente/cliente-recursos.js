// js/cliente/cliente-recursos.js - Módulo de Pagamento Rápido, Cupom, Nota e Ícone do Veículo
import { estadoCliente } from './cliente-estado.js';
import { notificarCliente, abrirPromptParada } from '../cliente-ui.js';
import { atualizarResumoValores } from './cliente-pedidos.js';

// 1. DADOS DE ESTADO ADICIONAIS
export const estadoRecursos = {
  formaPagamento: 'dinheiro', // 'dinheiro' | 'pix' | 'cartao'
  cupomAplicado: null,
  descontoPercentual: 0,
  notaMotorista: '',
  markerVeiculoAnimado: null
};

// Cupons promocionais disponíveis
const CUPONS_VALIDOS = {
  'HUBY10': 0.10,      // 10% de desconto
  'PRIMEIRA10': 0.10,  // 10% de desconto
  'HUBYVIP': 0.15      // 15% de desconto
};

// 2. CONFIGURAR SELETOR RÁPIDO DE PAGAMENTO
export function configurarSeletorPagamentoRapido() {
  const btnTrigger = document.getElementById('btnTriggerPagamento');
  const modalMetodos = document.getElementById('modalSeletorPagamentoRapido');
  const txtForma = document.getElementById('txtFormaPagamentoSelecionada');
  const iconForma = document.getElementById('iconFormaPagamento');

  btnTrigger?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (modalMetodos) modalMetodos.style.display = 'flex';
  });

  document.querySelectorAll('.opcao-pagamento-rapido').forEach(item => {
    item.addEventListener('click', () => {
      const metodo = item.getAttribute('data-metodo');
      const nome = item.getAttribute('data-nome');
      const icone = item.getAttribute('data-icone');

      estadoRecursos.formaPagamento = metodo;
      if (txtForma) txtForma.textContent = nome;
      if (iconForma) iconForma.textContent = icone;

      document.querySelectorAll('.opcao-pagamento-rapido').forEach(i => i.classList.remove('ativa'));
      item.classList.add('ativa');

      if (modalMetodos) modalMetodos.style.display = 'none';
      notificarCliente(`Forma de pagamento: ${nome}`, 'info');
    });
  });

  document.getElementById('btnFecharModalPgtoRapido')?.addEventListener('click', () => {
    if (modalMetodos) modalMetodos.style.display = 'none';
  });
}

// 3. CONFIGURAR NOTA / OBSERVAÇÃO PARA O MOTORISTA
export function configurarNotaMotorista() {
  const btnNota = document.getElementById('btnAdicionarNotaMotorista');
  const txtNotaBadge = document.getElementById('txtNotaMotoristaBadge');

  btnNota?.addEventListener('click', () => {
    abrirPromptParada({
      titulo: 'Nota para o Motorista',
      placeholder: 'Ex: Levar troco para 50, portão verde...',
      onConfirmar: (textoDigitado) => {
        estadoRecursos.notaMotorista = textoDigitado.trim();
        if (txtNotaBadge) {
          if (estadoRecursos.notaMotorista) {
            txtNotaBadge.textContent = `📝 "${estadoRecursos.notaMotorista}"`;
            txtNotaBadge.style.display = 'inline-block';
            btnNota.classList.add('com-nota');
          } else {
            txtNotaBadge.style.display = 'none';
            btnNota.classList.remove('com-nota');
          }
        }
        notificarCliente('Nota anexada ao pedido.', 'sucesso');
      }
    });
  });
}

// 4. CONFIGURAR CUPOM DE DESCONTO
export function configurarCupomDesconto() {
  const btnCupom = document.getElementById('btnAplicarCupom');
  const tagCupom = document.getElementById('tagCupomAtivo');

  btnCupom?.addEventListener('click', () => {
    if (estadoRecursos.cupomAplicado) {
      // Se já tem cupom, tocar para remover
      estadoRecursos.cupomAplicado = null;
      estadoRecursos.descontoPercentual = 0;
      if (tagCupom) tagCupom.style.display = 'none';
      btnCupom.textContent = '🏷️ Cupom';
      atualizarResumoValores();
      notificarCliente('Cupom removido.', 'info');
      return;
    }

    abrirPromptParada({
      titulo: 'Aplicar Cupom de Desconto',
      placeholder: 'Digite o código (Ex: HUBY10)',
      onConfirmar: (codigoDigitado) => {
        const codigo = codigoDigitado.trim().toUpperCase();
        if (CUPONS_VALIDOS[codigo]) {
          estadoRecursos.cupomAplicado = codigo;
          estadoRecursos.descontoPercentual = CUPONS_VALIDOS[codigo];

          if (tagCupom) {
            tagCupom.textContent = `${codigo} (-${CUPONS_VALIDOS[codigo] * 100}%)`;
            tagCupom.style.display = 'inline-block';
          }
          btnCupom.textContent = '✕ Remover';

          // Recalcula o resumo de valores
          atualizarResumoComDesconto();
          notificarCliente(`Cupom ${codigo} aplicado com sucesso!`, 'sucesso');
        } else {
          notificarCliente('Cupom inválido ou expirado.', 'alerta');
        }
      }
    });
  });
}

export function atualizarResumoComDesconto() {
  if (!estadoCliente.rotaAtual || !estadoCliente.rotaAtual.preco) return;

  const precoBruto = Number(estadoCliente.rotaAtual.preco);
  let precoFinal = precoBruto;

  if (estadoRecursos.descontoPercentual > 0) {
    precoFinal = precoBruto * (1 - estadoRecursos.descontoPercentual);
  }

  const lblPreco = document.getElementById('txtPrecoEstimado');
  if (lblPreco) {
    lblPreco.textContent = `R$ ${precoFinal.toFixed(2).replace('.', ',')}`;
  }
}

// MARCADOR VEICULAR COM SILHUETA AUTOMÓVEL NÍTIDA
export function criarOuAtualizarVeiculoMapa(mapaLeaflet, lat, lng, heading = 0, categoria = 'carro') {
  if (!mapaLeaflet) return;

  const iconeSVG = categoria === 'moto' ? `
    <div style="transform: rotate(${heading}deg); transition: transform 0.4s ease; width: 36px; height: 36px; background: #090D16; border: 2px solid #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
      <span style="font-size: 18px; line-height: 1;">🏍️</span>
    </div>
  ` : `
    <div style="transform: rotate(${heading}deg); transition: transform 0.4s ease; width: 38px; height: 38px; background: #090D16; border: 2px solid #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.7);">
      <span style="font-size: 20px; line-height: 1;">🚗</span>
    </div>
  `;

  const iconePersonalizado = L.divIcon({
    html: iconeSVG,
    className: 'huby-vehicle-marker-wrapper',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

  if (!estadoRecursos.markerVeiculoAnimado) {
    estadoRecursos.markerVeiculoAnimado = L.marker([lat, lng], { icon: iconePersonalizado, zIndexOffset: 1000 }).addTo(mapaLeaflet);
  } else {
    estadoRecursos.markerVeiculoAnimado.setLatLng([lat, lng]);
    estadoRecursos.markerVeiculoAnimado.setIcon(iconePersonalizado);
  }
}