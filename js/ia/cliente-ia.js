// js/ia/cliente-ia.js - Assistente Vocal e Busca Inteligente por IA HUBy
import { API_URL } from '../config.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaEmAndamento = false;

// Obtém coordenadas locais aproximadas do passageiro para âncora de busca
function obterCoordenadasUsuario() {
  const latSalva = localStorage.getItem('huby_user_lat') || localStorage.getItem('huby_origem_lat');
  const lngSalva = localStorage.getItem('huby_user_lng') || localStorage.getItem('huby_origem_lng');

  if (latSalva && lngSalva) {
    return { userLat: parseFloat(latSalva), userLng: parseFloat(lngSalva) };
  }
  return { userLat: null, userLng: null };
}

// Inicializa o reconhecimento de voz do passageiro
export function inicializarVozPassageiro() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnBuscaIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');

  if (!btnBuscaIA) return;

  if (!SpeechRecognition) {
    btnBuscaIA.addEventListener('click', () => {
      notificar('O seu navegador não suporta pesquisa por voz. Digite o endereço.', 'alerta');
      inputPesquisa?.focus();
    });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    escutaEmAndamento = true;
    btnBuscaIA.style.color = '#EF4444';
    btnBuscaIA.style.transform = 'scale(1.2)';
    btnBuscaIA.style.transition = 'transform 0.2s ease, color 0.2s ease';
    notificar('A ouvir destino... Diga para onde deseja ir.', 'info', 3000);
  };

  recognition.onend = () => {
    escutaEmAndamento = false;
    btnBuscaIA.style.color = '#38BDF8';
    btnBuscaIA.style.transform = 'scale(1)';
  };

  recognition.onerror = (ev) => {
    escutaEmAndamento = false;
    btnBuscaIA.style.color = '#38BDF8';
    btnBuscaIA.style.transform = 'scale(1)';
    if (ev.error !== 'no-speech') {
      notificar('Não foi possível identificar o áudio. Tente novamente.', 'alerta');
    }
  };

  recognition.onresult = async (ev) => {
    const transcricao = ev.results[0][0].transcript;
    if (!transcricao || !transcricao.trim()) return;

    if (inputPesquisa) inputPesquisa.value = transcricao;
    notificar(`A pesquisar destino: "${transcricao}"`, 'info', 2500);

    await consultarDestinoIA(transcricao);
  };

  btnBuscaIA.addEventListener('click', (e) => {
    e.preventDefault();
    if (escutaEmAndamento) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        recognition.stop();
      }
    }
  });
}

// Envia a fala para o backend (ia.routes.js -> /api/ia/localizar-referencia)
async function consultarDestinoIA(frase) {
  const { userLat, userLng } = obterCoordenadasUsuario();
  const token = localStorage.getItem('huby_token');

  try {
    const resp = await fetch(`${API_URL}/api/ia/localizar-referencia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        referencia: frase,
        userLat,
        userLng
      })
    });

    const data = await resp.json();

    if (!resp.ok || !data.sucesso || !data.resultado) {
      throw new Error(data.erro || 'Localização não identificada.');
    }

    const { nome_curto, lat, lng } = data.resultado;

    // Dispara o evento captado pelo app-cliente.js para traçar a rota e abrir as categorias
    window.dispatchEvent(new CustomEvent('huby_local_selecionado_ia', {
      detail: {
        nome: nome_curto,
        lat: Number(lat),
        lng: Number(lng),
        origem: 'ia_voz'
      }
    }));

    notificar(`Destino traçado: ${nome_curto}`, 'sucesso');
  } catch (err) {
    console.warn('Erro na rota IA:', err);
    notificar(err.message || 'Não conseguimos identificar o local. Digite manualmente.', 'alerta');
  }
}

// Inicialização automática
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarVozPassageiro);
} else {
  inicializarVozPassageiro();
}