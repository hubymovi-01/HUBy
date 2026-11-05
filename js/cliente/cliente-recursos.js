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

// 5. MARCADOR VEICULAR SVG ANIMADO COM ROTAÇÃO SUAVE
export function criarOuAtualizarVeiculoMapa(mapaLeaflet, lat, lng, heading = 0, categoria = 'carro') {
  if (!mapaLeaflet) return;

  const iconeSVG = categoria === 'moto' ? `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="transform: rotate(${heading}deg); transition: transform 0.3s ease;">
      <circle cx="12" cy="12" r="11" fill="#10B981" stroke="#FFF" stroke-width="2"/>
      <path d="M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-7-4l2-3h3l2 3" stroke="#FFF" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  ` : `
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" style="transform: rotate(${heading}deg); transition: transform 0.3s ease;">
      <circle cx="12" cy="12" r="11" fill="#10B981" stroke="#FFF" stroke-width="2"/>
      <path d="M5 14l1.5-4.5h11L19 14M7 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" stroke="#FFF" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;

  const iconePersonalizado = L.divIcon({
    html: iconeSVG,
    className: 'huby-vehicle-marker-wrapper',
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });

  if (!estadoRecursos.markerVeiculoAnimado) {
    estadoRecursos.markerVeiculoAnimado = L.marker([lat, lng], { icon: iconePersonalizado, zIndexOffset: 1000 }).addTo(mapaLeaflet);
  } else {
    estadoRecursos.markerVeiculoAnimado.setLatLng([lat, lng]);
    estadoRecursos.markerVeiculoAnimado.setIcon(iconePersonalizado);
  }
}