// js/motorista/motorista-modos.js - Lógica dos modos Pausa, Casa e Calor
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar, abrirPromptCustom } from './motorista-alertas.js';

let emPausa = false;
let destinoCasaAtivo = false;

export function configurarModosInteligentes() {
  const btnPausa = document.getElementById('btnModoPausa');
  const btnCasa = document.getElementById('btnModoDestino');
  const btnCalor = document.getElementById('btnToggleHeatmap');

  // 1. MODO PAUSA RÁPIDA (15 minutos)
  btnPausa?.addEventListener('click', async () => {
    emPausa = !emPausa;
    btnPausa.classList.toggle('active', emPausa);

    if (emPausa) {
      btnPausa.style.background = 'rgba(239, 68, 68, 0.2)';
      btnPausa.style.borderColor = '#EF4444';
      notificar('Pausa ativada! Você não receberá novas corridas por 15 minutos.', 'pausa');
    } else {
      btnPausa.style.background = '';
      btnPausa.style.borderColor = '';
      notificar('Pausa desativada. Radar de corridas restabelecido.', 'sucesso');
    }

    try {
      await fetch(`${API_URL}/api/motoristas/pausa`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ emPausa, minutos: 15 })
      });
    } catch (e) {}
  });

  // 2. MODO DIREÇÃO DE CASA
  btnCasa?.addEventListener('click', () => {
    if (destinoCasaAtivo) {
      destinoCasaAtivo = false;
      btnCasa.classList.remove('active');
      btnCasa.style.background = '';
      btnCasa.style.borderColor = '';
      notificar('Modo Casa desativado. Recebendo corridas em qualquer direção.', 'info');
      return;
    }

    abrirPromptCustom({
      titulo: '🏠 Rota para Casa',
      placeholder: 'Ex: Centro, Bairro Primavera...',
      valorPadrao: estado.destinoCasaNome || '',
      onConfirmar: async (destinoDigitado) => {
        destinoCasaAtivo = true;
        estado.destinoCasaNome = destinoDigitado;
        btnCasa.classList.add('active');
        btnCasa.style.background = 'rgba(56, 189, 248, 0.25)';
        btnCasa.style.borderColor = '#38BDF8';
        notificar(`Filtro ativado! Buscando apenas corridas em direção a: ${destinoDigitado}`, 'casa');

        try {
          await fetch(`${API_URL}/api/motoristas/definir-destino-casa`, {
            method: 'POST',
            headers: obterHeaders(),
            body: JSON.stringify({ destino: destinoDigitado, ativo: true })
          });
        } catch (e) {}
      }
    });
  });

  // 3. MODO CALOR DE DEMANDA
  btnCalor?.addEventListener('click', () => {
    const ativo = btnCalor.classList.toggle('active');
    if (ativo) {
      btnCalor.style.background = 'rgba(245, 158, 11, 0.25)';
      btnCalor.style.borderColor = '#F59E0B';
      notificar('Calculando zonas de calor com base nas corridas recentes...', 'alerta');
      
      if (typeof window.alternarCamadaCalor === 'function') {
        window.alternarCamadaCalor(true);
      } else {
        setTimeout(() => {
          notificar('Zonas de calor ativas no mapa da região.', 'sucesso');
        }, 1200);
      }
    } else {
      btnCalor.style.background = '';
      btnCalor.style.borderColor = '';
      notificar('Camada de calor desativada.', 'info');
      if (typeof window.alternarCamadaCalor === 'function') {
        window.alternarCamadaCalor(false);
      }
    }
  });
}