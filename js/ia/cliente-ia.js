// js/ia/cliente-ia.js - Assistente Vocal e Busca Inteligente por IA HUBy
import { API_URL } from '../config.js';
import { notificar } from '../util/alertas-huby.js';

let recognition = null;
let escutaEmAndamento = false;

function obterCoordenadasUsuario() {
  const latSalva = localStorage.getItem('huby_user_lat') || localStorage.getItem('huby_origem_lat');
  const lngSalva = localStorage.getItem('huby_user_lng') || localStorage.getItem('huby_origem_lng');

  if (latSalva && lngSalva) {
    return { userLat: parseFloat(latSalva), userLng: parseFloat(lngSalva) };
  }
  return { userLat: null, userLng: null };
}

export function inicializarVozPassageiro() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnBuscaIA = document.getElementById('btnBuscaIA');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');

  if (!btnBuscaIA) return;

  if (!SpeechRecognition) {
    btnBuscaIA.addEventListener('click', () => {
      notificar('Seu navegador não suporta pesquisa por voz. Digite o endereço.', 'alerta');
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
    notificar('Ouvindo destino... Diga para onde você quer ir.', 'info', 3000);
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
      notificar('Não foi possível identificar o áudio. Tente falar novamente.', 'alerta');
    }
  };

  recognition.onresult = async (ev) => {
    const transcricao = ev.results[0][0].transcript;
    if (!transcricao || !transcricao.trim()) return;

    if (inputPesquisa) inputPesquisa.value = transcricao;
    notificar(`Pesquisando: "${transcricao}"`, 'info', 2500);

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

    const data = await resp.json().catch(() => null);

    if (data && data.sucesso && data.resultado) {
      aplicarDestinoNoMapa(data.resultado);
      return;
    }

    // Se o backend avisar que não achou, aciona o fallback direto pelo cliente
    await fallbackGeocodificacaoDireta(frase);

  } catch (err) {
    console.warn('Backend indisponível, tentando fallback no cliente:', err);
    await fallbackGeocodificacaoDireta(frase);
  }
}

// Fallback direto no OpenStreetMap caso a IA ou a rede do servidor oscilem
async function fallbackGeocodificacaoDireta(termo) {
  const termoLimpo = termo
    .replace(/^(quero ir para|me leva para|me leve para|ir para|vamos para|ir ate|ir até|vou para|ir ao|me leva no)\s+/i, '')
    .trim();

  const buscas = [
    termoLimpo,
    `${termoLimpo}, Piauí, Brasil`,
    `${termoLimpo}, Brasil`
  ];

  for (const b of buscas) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(b)}&countrycodes=br&limit=1`);
      if (res.ok) {
        const itens = await res.json().catch(() => null);
        if (Array.isArray(itens) && itens.length > 0 && itens[0]) {
          const item = itens[0];
          aplicarDestinoNoMapa({
            nome_curto: item.display_name.split(',').slice(0, 2).join(', '),
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon)
          });
          return;
        }
      }
    } catch (e) {}
  }

  notificar('Local não identificado. Tente digitar o endereço ou escolher no mapa.', 'alerta');
}

function aplicarDestinoNoMapa(resultado) {
  const { nome_curto, lat, lng } = resultado;

  window.dispatchEvent(new CustomEvent('huby_local_selecionado_ia', {
    detail: {
      nome: nome_curto,
      lat: Number(lat),
      lng: Number(lng),
      origem: 'ia_voz'
    }
  }));

  notificar(`Destino traçado: ${nome_curto}`, 'sucesso');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarVozPassageiro);
} else {
  inicializarVozPassageiro();
}