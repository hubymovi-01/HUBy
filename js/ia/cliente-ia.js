// js/ia/cliente-ia.js - Controlador de Voz e IA HUBy (Nacional com Âncora de Proximidade)
import { API_URL } from '../config.js';
import { vozUI } from './voz-ui.js';
import { configurarIAFlash, processarComandoFlashIA } from './flash-ia.js';

document.addEventListener('DOMContentLoaded', () => {
  const btnIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');

  if (!btnIA || !inputPesquisa) return;

  configurarIAFlash();

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Reconhecimento de voz não suportado neste dispositivo.');
    btnIA.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;

  let gravando = false;

  function iniciarGravacao() {
    if (gravando) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
    } catch (err) {
      console.warn('Erro ao iniciar reconhecimento de voz:', err);
    }
  }

  btnIA.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    iniciarGravacao();
  });

  recognition.onstart = () => {
    gravando = true;
    inputPesquisa.placeholder = 'A escutar... Fale o seu destino!';
    vozUI.tocarBipInicio();
    vozUI.ativarPulsoGravando();
  };

  recognition.onend = () => {
    gravando = false;
    inputPesquisa.placeholder = 'Para onde você quer ir?';
    vozUI.desativarPulso();
  };

  recognition.onresult = async (event) => {
    const textoFalado = event.results[0][0].transcript;
    inputPesquisa.value = textoFalado;

    btnIA.innerHTML = '<span style="font-size:14px;">🧠</span>';

    // Se for encomenda (Flash), processa o recebedor em paralelo
    const cardFlash = document.querySelector('.category-card-pro[data-id="entrega"]');
    if (cardFlash && cardFlash.classList.contains('active')) {
      processarComandoFlashIA(textoFalado);
    }

    try {
      // Captura o GPS atual do usuário gravado no app ou no mapa
      let userLat = null;
      let userLng = null;

      if (window.estadoCliente && window.estadoCliente.coordsOrigem) {
        userLat = window.estadoCliente.coordsOrigem[0];
        userLng = window.estadoCliente.coordsOrigem[1];
      }

      const urlDestino = `${API_URL}/api/ia/localizar-referencia`;
      console.log('📡 [IA Frontend] Enviando comando com âncora geográfica:', { textoFalado, userLat, userLng });

      const res = await fetch(urlDestino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referencia: textoFalado,
          userLat,
          userLng
        })
      });

      const data = await res.json();
      console.log('📥 [IA Frontend] Resposta recebida:', data);

      if (res.ok && data.resultado && !isNaN(data.resultado.lat)) {
        const nomeDestino = data.resultado.nome_curto || textoFalado;
        const lat = parseFloat(data.resultado.lat);
        const lng = parseFloat(data.resultado.lng);

        inputPesquisa.value = nomeDestino;
        vozUI.tocarSucesso();

        // Dispara o evento que desenha a rota no Leaflet
        const evt = new CustomEvent('huby_local_selecionado_ia', {
          detail: { nome: nomeDestino, lat, lng }
        });
        document.dispatchEvent(evt);

        vozUI.exibirBadgeRetentativa(() => {
          iniciarGravacao();
        });
      } else {
        alert(data.erro || 'Não foi possível encontrar este local. Tente falar novamente.');
      }
    } catch (err) {
      console.error('Erro na chamada de IA:', err);
      alert('Falha na comunicação com o servidor de IA.');
    } finally {
      btnIA.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      `;
    }
  };
});