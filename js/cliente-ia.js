// js/cliente-ia.js - Módulo Isolado de Inteligência Artificial para o Passageiro
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
    if (gravando) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
    } catch (err) {
      console.warn('Erro ao iniciar gravação de voz:', err);
    }
  });

  recognition.onstart = () => {
    gravando = true;
    inputPesquisa.placeholder = "Escutando... Pode falar!";
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
    
    btnIA.innerHTML = '<span style="font-size:12px;">🧠</span>';

    try {
      const token = localStorage.getItem('huby_token');
      
      const res = await fetch(`${API_URL}/api/ia/localizar-referencia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ 
          referencia: textoFalado,
          cidadeBase: 'São João do Piauí, Piauí'
        })
      });

      const data = await res.json();

      if (res.ok && data.resultado && data.resultado.lat) {
        const listaFake = document.getElementById('listaResultadosPesquisa');
        if (listaFake) {
          listaFake.style.display = 'block';
          listaFake.innerHTML = `
            <li class="result-item ia-result" style="border: 2px solid #38BDF8; background: rgba(56,189,248,0.1);">
              <div class="icon" style="background:#38BDF8; color:#000;">🧠</div>
              <div class="details">
                <strong>${data.resultado.nome_curto || 'Local Encontrado (IA)'}</strong>
                <small>Localização encontrada pela inteligência do aplicativo</small>
              </div>
            </li>
          `;

          const li = listaFake.querySelector('.ia-result');
          li.onclick = () => {
            const evt = new CustomEvent('huby_local_selecionado_ia', {
              detail: {
                nome: data.resultado.nome_curto,
                lat: data.resultado.lat,
                lng: data.resultado.lng
              }
            });
            document.dispatchEvent(evt);
            
            listaFake.style.display = 'none';
            inputPesquisa.value = data.resultado.nome_curto;
          };
        }
      } else {
        alert(data.erro || 'A IA não conseguiu decifrar este local. Tente falar novamente.');
      }
    } catch (err) {
      alert('Erro de conexão com a IA.');
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