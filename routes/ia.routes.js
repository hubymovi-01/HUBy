// routes/ia.routes.js - Geocodificação Nacional com Proximidade Inteligente
import express from 'express';

const router = express.Router();

// Geocodificador Nominatim com Bounding Box (âncora no raio de proximidade)
async function buscarNominatimBrasil(termo, lat = null, lng = null) {
  if (!termo || !termo.trim()) return null;

  const termoLimpo = termo
    .replace(/^(quero ir para|me leva para|me leve para|ir para|vamos para|ir ate|ir até|vou para|ir ao|me leva no|me leva na)\s+/i, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .trim();

  let params = `q=${encodeURIComponent(termoLimpo)}&format=json&countrycodes=br&addressdetails=1&limit=1`;

  // Se o GPS do passageiro for fornecido, cria uma caixa de proximidade (~50km ao redor)
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
    const delta = 0.45; // ~50km de raio
    const minLng = (lng - delta).toFixed(4);
    const maxLng = (lng + delta).toFixed(4);
    const minLat = (lat - delta).toFixed(4);
    const maxLat = (lat + delta).toFixed(4);
    params += `&viewbox=${minLng},${maxLat},${maxLng},${minLat}`;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HUBy-Mobility-Brasil/3.0 (contato@hubymovi.com)'
      }
    });

    if (res.ok) {
      const dados = await res.json();
      if (dados && dados.length > 0) {
        const item = dados[0];
        const partes = item.display_name.split(',');
        const nomeCurto = partes.slice(0, 2).map(p => p.trim()).join(', ');

        return {
          nome_curto: nomeCurto,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon)
        };
      }
    }
  } catch (err) {
    console.warn('⚠️ Erro ao consultar base geográfica:', err.message);
  }

  // Fallback sem viewbox (caso seja uma busca de outra cidade ou estado)
  if (lat && lng) {
    try {
      const urlGlobal = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(termoLimpo + ', Brasil')}&format=json&countrycodes=br&limit=1`;
      const resGlobal = await fetch(urlGlobal, {
        headers: { 'User-Agent': 'HUBy-Mobility-Brasil/3.0 (contato@hubymovi.com)' }
      });
      if (resGlobal.ok) {
        const lista = await resGlobal.json();
        if (lista && lista.length > 0) {
          const item = lista[0];
          return {
            nome_curto: item.display_name.split(',').slice(0, 2).join(', '),
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon)
          };
        }
      }
    } catch (e) {}
  }

  return null;
}

// Endpoint de Localização e Voz com IA para qualquer ponto do Brasil
router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, userLat, userLng } = req.body;

    console.log('🤖 [IA HUBy] Comando recebido:', { referencia, userLat, userLng });

    if (!referencia || !referencia.trim()) {
      return res.status(400).json({ erro: 'Por favor, fale ou informe o endereço de destino.' });
    }

    let termoFormatado = referencia.trim();
    let latFinal = null;
    let lngFinal = null;
    let nomeFinal = null;

    const apiKey = process.env.GEMINI_API_KEY;

    // 1. O Gemini interpreta a fala e tenta retornar as coordenadas ou o termo limpo
    if (apiKey) {
      try {
        const contextoGPS = (userLat && userLng) 
          ? `O passageiro está localizado próximo a lat: ${userLat}, lng: ${userLng} no Brasil.` 
          : 'O passageiro está no Brasil.';

        const prompt = `Você é o geocodificador inteligente do aplicativo HUBy no Brasil.
${contextoGPS}
O passageiro falou o destino: "${referencia}".

Instruções:
1. Extraia o destino real. Remova comandos conversacionais como "quero ir", "me leva".
2. Se o destino for uma rua ou bairro local próximo ao passageiro, priorize a região onde ele está. Se for outra cidade ou estado, use o destino falado.
3. Se você tiver certeza absoluta das coordenadas no Brasil, preencha lat e lng. Caso contrário, retorne lat e lng como null.
4. Retorne RIGOROSAMENTE apenas um JSON:
{
  "nome_curto": "Nome da Rua ou Cidade, UF",
  "termo_busca": "Nome Limpo Para Busca",
  "lat": -8.3582 ou null,
  "lng": -42.2476 ou null
}`;

        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const respGemini = await fetch(urlGemini, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        });

        if (respGemini.ok) {
          const json = await respGemini.json();
          const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (raw) {
            const parsed = JSON.parse(raw.trim());
            if (parsed.termo_busca) termoFormatado = parsed.termo_busca;
            if (parsed.lat && parsed.lng && !isNaN(parsed.lat) && !isNaN(parsed.lng)) {
              latFinal = parseFloat(parsed.lat);
              lngFinal = parseFloat(parsed.lng);
              nomeFinal = parsed.nome_curto || termoFormatado;
            }
          }
        }
      } catch (errGemini) {
        console.warn('⚠️ [IA Gemini] Fallback direto para Nominatim:', errGemini.message);
      }
    }

    // 2. Se a IA não cravou as coordenadas, a base geográfica com âncora de proximidade localiza
    let resultadoFinal = null;
    if (latFinal && lngFinal) {
      resultadoFinal = { nome_curto: nomeFinal, lat: latFinal, lng: lngFinal };
    } else {
      resultadoFinal = await buscarNominatimBrasil(termoFormatado, userLat, userLng);
      if (!resultadoFinal && termoFormatado !== referencia) {
        resultadoFinal = await buscarNominatimBrasil(referencia, userLat, userLng);
      }
    }

    if (!resultadoFinal) {
      return res.status(404).json({
        erro: 'Não conseguimos identificar este local. Tente falar com mais detalhes (ex: rua e bairro).'
      });
    }

    console.log('✅ [HUBy Geocodificação] Destino validado no Brasil:', resultadoFinal);
    return res.json({
      sucesso: true,
      resultado: resultadoFinal
    });

  } catch (err) {
    console.error('❌ [IA] Erro na rota:', err);
    return res.status(500).json({
      erro: 'Falha temporária ao processar a localização.',
      detalhe: err.message
    });
  }
});

// Rota de Extração Inteligente de Encomendas HUBy Flash (Nacional)
router.post('/flash-extrair', async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ erro: 'Texto de instrução não fornecido.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ erro: 'Chave GEMINI_API_KEY ausente.' });
    }

    const prompt = `Extraia dados da ordem de entrega no Brasil: "${texto}".
Retorne APENAS um JSON:
{
  "recebedor": "Nome e telefone",
  "tipoItem": "documento" | "pequeno" | "medio" | "fragil",
  "observacao": "Instrução curta ou null"
}`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) {
        return res.json({ sucesso: true, resultado: JSON.parse(txt.trim()) });
      }
    }
    return res.status(500).json({ erro: 'Falha ao processar encomenda.' });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

// Rota de Smart Replies Contextuais para o Motorista
router.post('/motorista-respostas', async (req, res) => {
  const fallback = ['Estou a caminho!', 'Chego em 2 minutos.', 'Já cheguei no local!'];
  try {
    const { mensagem } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !mensagem) {
      return res.json({ sucesso: true, sugestoes: fallback });
    }

    const prompt = `Gere exatamente 3 sugestões curtas de resposta no trânsito para o motorista à mensagem: "${mensagem}".
Retorne APENAS um JSON: {"sugestoes": ["...", "...", "..."]}`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) {
        const parsed = JSON.parse(txt.trim());
        if (Array.isArray(parsed.sugestoes)) {
          return res.json({ sucesso: true, sugestoes: parsed.sugestoes.slice(0, 3) });
        }
      }
    }
    return res.json({ sucesso: true, sugestoes: fallback });
  } catch (err) {
    return res.json({ sucesso: true, sugestoes: fallback });
  }
});

export default router;