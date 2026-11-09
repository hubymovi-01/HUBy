// js/cliente-ia.js - Módulo de Inteligência Artificial para o Passageiro
import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const btnIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  
  if (!btnIA || !inputPesquisa) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Reconhecimento de voz não suportado neste navegador.');
    btnIA.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;

  let gravando = false;

  btnIA.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (gravando) {
      recognition.stop();
      return;
    }

    try {
      recognition.start();
    } catch (err) {
      console.warn('Erro ao iniciar reconhecimento de voz:', err);
    }
  });

  recognition.onstart = () => {
    gravando = true;
    inputPesquisa.placeholder = "Escutando... Fale o seu destino!";
    btnIA.style.color = '#EF4444';
  };

  recognition.onend = () => {
    gravando = false;
    inputPesquisa.placeholder = "Para onde você quer ir?";
    btnIA.style.color = '#38BDF8';
  };

  recognition.onresult = async (event) => {
    const textoFalado = event.results[0][0].transcript;
    inputPesquisa.value = textoFalado;
    
    btnIA.innerHTML = '<span style="font-size:14px; animation: pulse 1s infinite;">🧠</span>';

    try {
      const urlDestino = `${API_URL}/api/ia/localizar-referencia`;
      console.log('📡 [IA Frontend] Enviando áudio transcrito:', textoFalado);

      const res = await fetch(urlDestino, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          referencia: textoFalado,
          cidadeBase: 'São João do Piauí, Piauí'
        })
      });

      const data = await res.json();
      console.log('📥 [IA Frontend] Resposta:', data);

      if (res.ok && data.resultado && !isNaN(data.resultado.lat)) {
        const nomeDestino = data.resultado.nome_curto || textoFalado;
        const lat = parseFloat(data.resultado.lat);
        const lng = parseFloat(data.resultado.lng);

        // Dispara o evento direto para o mapa no app-cliente.js
        const evt = new CustomEvent('huby_local_selecionado_ia', {
          detail: { nome: nomeDestino, lat, lng }
        });
        document.dispatchEvent(evt);

        // Exibe o card visual de confirmação na lista
        const listaFake = document.getElementById('listaResultadosPesquisa');
        if (listaFake) {
          listaFake.style.display = 'block';
          listaFake.innerHTML = `
            <li class="result-item ia-result" style="border: 2px solid #38BDF8; background: rgba(56,189,248,0.15); cursor: pointer; padding: 12px; border-radius: 10px; display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
              <div style="background:#38BDF8; color:#000; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 14px; font-weight: bold;">🧠</div>
              <div style="flex: 1;">
                <strong style="color: #FFF; font-size: 14px; display: block;">${nomeDestino}</strong>
                <small style="color: #38BDF8; font-size: 11px; font-weight: 600;">Destino traçado com Inteligência Artificial</small>
              </div>
            </li>
          `;

          setTimeout(() => {
            listaFake.style.display = 'none';
          }, 3500);
        }
      } else {
        alert(data.erro || data.detalhe || 'A IA não conseguiu decifrar este local. Tente falar novamente.');
      }
    } catch (err) {
      console.error('Erro ao conectar com a IA:', err);
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