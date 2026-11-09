// js/cliente-ia.js - Módulo Isolado de Inteligência Artificial para o Passageiro
import { API_URL } from './config.js'; // Ajuste o caminho do config se necessário

document.addEventListener('DOMContentLoaded', () => {
  const btnIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  
  if (!btnIA || !inputPesquisa) return;

  // Verifica se o navegador suporta reconhecimento de voz
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Reconhecimento de voz não suportado neste navegador.');
    btnIA.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR'; // Configurado para Português do Brasil
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

  // Eventos Visuais de Gravação
  recognition.onstart = () => {
    gravando = true;
    inputPesquisa.placeholder = "Escutando... Pode falar!";
    btnIA.style.color = '#EF4444'; // Fica vermelho enquanto escuta
    btnIA.classList.add('pulse-anim'); // Opcional: crie uma classe de CSS para pulsar
  };

  recognition.onend = () => {
    gravando = false;
    inputPesquisa.placeholder = "Para onde você quer ir?";
    btnIA.style.color = '#38BDF8';
    btnIA.classList.remove('pulse-anim');
  };

  // Quando a voz for convertida em texto, enviamos para a IA do Gemini
  recognition.onresult = async (event) => {
    const textoFalado = event.results[0][0].transcript;
    inputPesquisa.value = textoFalado; // Preenche o campo de texto com o que o utilizador falou
    
    // Mostra indicador de processamento IA
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
          cidadeBase: 'São João do Piauí, Piauí' // Configure a cidade de teste aqui
        })
      });

      const data = await res.json();

      if (res.ok && data.resultado && data.resultado.lat) {
        // Se a IA achar as coordenadas, simulamos um clique na lista de pesquisa do HUBy
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
            // Emite um evento customizado que o ficheiro app-cliente.js pode apanhar para marcar no mapa
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
      // Restaura o ícone do microfone
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