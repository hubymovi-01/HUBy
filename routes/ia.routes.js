// routes/ia.routes.js - Geocodificação Nacional com Proximidade Inteligente e Fallback Blindado
import express from 'express';

const router = express.Router();

// Geocodificador Nominatim flexível e tolerante
async function buscarNominatimBrasil(termo, lat = null, lng = null) {
  if (!termo || !String(termo).trim()) return null;

  const termoLimpo = String(termo)
    .replace(/^(quero ir para|me leva para|me leve para|ir para|vamos para|ir ate|ir até|vou para|ir ao|me leva no|me leva na|levar em)\s+/i, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .trim();

  const tentativas = [
    termoLimpo,
    `${termoLimpo}, Piauí, Brasil`,
    `${termoLimpo}, Brasil`
  ];

  for (const busca of tentativas) {
    try {
      let params = `q=${encodeURIComponent(busca)}&format=json&countrycodes=br&limit=1`;
      
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'HUBy-Mobilidade-Brasil/3.2 (contato@hubymovi.com)' }
      });

      if (res.ok) {
        const dados = await res.json().catch(() => null);
        if (Array.isArray(dados) && dados.length > 0 && dados[0]) {
          const item = dados[0];
          const latNum = parseFloat(item.lat);
          const lngNum = parseFloat(item.lon);

          if (!isNaN(latNum) && !isNaN(lngNum)) {
            const partes = (item.display_name || busca).split(',');
            const nomeCurto = partes.slice(0, 2).map(p => p.trim()).join(', ');

            return {
              nome_curto: nomeCurto || termoLimpo,
              lat: latNum,
              lng: lngNum
            };
          }
        }
      }
    } catch (e) {
      console.warn('Tentativa Nominatim falhou para:', busca, e.message);
    }
  }

  return null;
}

// Endpoint de Localização e Voz
router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, userLat, userLng } = req.body || {};

    if (!referencia || !String(referencia).trim()) {
      return res.status(200).json({
        sucesso: false,
        erro: 'Por favor, fale ou informe o endereço de destino.'
      });
    }

    let termoFormatado = String(referencia).trim();
    let latFinal = null;
    let lngFinal = null;
    let nomeFinal = null;

    const apiKey = process.env.GEMINI_API_KEY;

    // 1. O Gemini interpreta o local falado e deduz as coordenadas quando souber
    if (apiKey) {
      try {
        const contextoGPS = (userLat && userLng)
          ? `O passageiro está próximo a lat: ${userLat}, lng: ${userLng} no estado do Piauí / Brasil.`
          : 'O passageiro está no Brasil, região do Piauí.';

        const prompt = `Você é o geocodificador inteligente do aplicativo de mobilidade HUBy no Brasil.
${contextoGPS}
O passageiro falou o destino: "${referencia}".

Instruções:
1. Extraia o nome real do local (rua, praça, bairro ou cidade).
2. Se você souber as coordenadas geográficas precisas dessa cidade, bairro ou ponto no Brasil, preencha os campos "lat" e "lng". Se não tiver certeza absoluta, retorne null neles.
3. Retorne RIGOROSAMENTE apenas um JSON no formato:
{
  "nome_curto": "Nome do Local ou Cidade, UF",
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
          const json = await respGemini.json().catch(() => null);
          const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (raw) {
            const parsed = JSON.parse(raw.trim());
            if (parsed.termo_busca) termoFormatado = parsed.termo_busca;
            if (parsed.lat && parsed.lng && !isNaN(Number(parsed.lat)) && !isNaN(Number(parsed.lng))) {
              latFinal = parseFloat(parsed.lat);
              lngFinal = parseFloat(parsed.lng);
              nomeFinal = parsed.nome_curto || termoFormatado;
            }
          }
        }
      } catch (errGemini) {
        console.warn('⚠️ [IA Gemini] Erro ao consultar Gemini:', errGemini.message);
      }
    }

    // 2. Se o Gemini não cravou as coordenadas, pesquisa no Nominatim
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
      return res.status(200).json({
        sucesso: false,
        erro: 'Não conseguimos identificar este local com precisão. Tente falar com mais detalhes (ex: rua e bairro).'
      });
    }

    return res.status(200).json({
      sucesso: true,
      resultado: resultadoFinal
    });

  } catch (err) {
    console.error('❌ [IA] Erro na rota:', err.message);
    return res.status(200).json({
      sucesso: false,
      erro: 'Falha temporária ao processar a localização.'
    });
  }
});

// Rota de Extração Inteligente de Encomendas HUBy Flash (Nacional)
router.post('/flash-extrair', async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(200).json({ sucesso: false, erro: 'Texto de instrução não fornecido.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        sucesso: true,
        resultado: {
          recebedor: 'A informar',
          tipoItem: 'pequeno',
          observacao: texto
        }
      });
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
      const data = await resp.json().catch(() => null);
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) {
        return res.json({ sucesso: true, resultado: JSON.parse(txt.trim()) });
      }
    }

    return res.status(200).json({
      sucesso: true,
      resultado: {
        recebedor: 'A informar',
        tipoItem: 'pequeno',
        observacao: texto
      }
    });
  } catch (err) {
    return res.status(200).json({ sucesso: false, erro: err.message });
  }
});

// Rota de Smart Replies Contextuais para o Motorista
router.post('/motorista-respostas', async (req, res) => {
  const fallback = ['Estou a caminho!', 'Chego em 2 minutos.', 'Já cheguei no local!'];
  try {
    const { mensagem } = req.body || {};
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
      const data = await resp.json().catch(() => null);
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
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