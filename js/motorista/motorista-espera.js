// js/motorista/motorista-espera.js
import { estado } from './motorista-estado.js';

let timerEspera = null;
let segundosPassados = 0;
const TEMPO_CORTESIA_SEGUNDOS = 180; // 3 minutos de cortesia grátis
const VALOR_POR_MINUTO_ESPERA = 0.40; // R$ 0,40 por minuto excedente

export function iniciarContadorEspera(aoAtualizarCallback) {
  pararContadorEspera();
  segundosPassados = 0;

  timerEspera = setInterval(() => {
    segundosPassados++;

    const emCortesia = segundosPassados <= TEMPO_CORTESIA_SEGUNDOS;
    const segundosRestantesCortesia = Math.max(0, TEMPO_CORTESIA_SEGUNDOS - segundosPassados);
    
    let taxaAdicional = 0;
    if (!emCortesia) {
      const minutosCobrados = Math.ceil((segundosPassados - TEMPO_CORTESIA_SEGUNDOS) / 60);
      taxaAdicional = minutosCobrados * VALOR_POR_MINUTO_ESPERA;
    }

    if (aoAtualizarCallback) {
      aoAtualizarCallback({
        segundosPassados,
        emCortesia,
        segundosRestantesCortesia,
        taxaAdicional
      });
    }
  }, 1000);
}

export function pararContadorEspera() {
  if (timerEspera) {
    clearInterval(timerEspera);
    timerEspera = null;
  }
  const taxaFinal = calcularTaxaAcumulada();
  segundosPassados = 0;
  return taxaFinal;
}

export function calcularTaxaAcumulada() {
  if (segundosPassados <= TEMPO_CORTESIA_SEGUNDOS) return 0;
  const minutosExcedentes = Math.ceil((segundosPassados - TEMPO_CORTESIA_SEGUNDOS) / 60);
  return Number((minutosExcedentes * VALOR_POR_MINUTO_ESPERA).toFixed(2));
}

export function formatarTempo(segundos) {
  const m = Math.floor(segundos / 60).toString().padStart(2, '0');
  const s = (segundos % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}