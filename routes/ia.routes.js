// routes/ia.routes.js - Geocodificação Nacional Blindada com Fallback sem Erro 500
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
  if (lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
    const delta = 0.45;
    const minLng = (Number(lng) - delta).toFixed(4);
    const maxLng = (Number(lng) + delta).toFixed(4);
    const minLat = (Number(lat) - delta).toFixed(4);
    const maxLat = (Number(lat) + delta).toFixed(4);
    params += `&viewbox=${minLng},${maxLat},${maxLng},${minLat}`;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HUBy-Mobility-Brasil/3.0 (suporte@hubymovi.com)'
      }
    });

    if (res.ok) {
      const dados = await res.json().catch(() => null);
      if (Array.isArray(dados) && dados.length > 0 && dados[0]) {
        const item = dados[0];
        const nomeCompleto = String(item.display_name || termoLimpo);
        const partes = nomeCompleto.split(',');
        const nomeCurto = partes.slice(0, 2).map((p) => p.trim()).join(', ');

        const latNum = parseFloat(item.lat);
        const lngNum = parseFloat(item.lon);

        if (!isNaN(latNum) && !isNaN(lngNum)) {
          return {
            nome_curto: nomeCurto || termoLimpo,
            lat: latNum,
            lng: lngNum
          };
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Erro ao consultar Nominatim com viewbox:', err.message);
  }

  // Fallback global sem viewbox
  try {
    const urlGlobal = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(termoLimpo + ', Brasil')}&format=json&countrycodes=br&limit=1`;
    const resGlobal = await fetch(urlGlobal, {
      headers: { 'User-Agent': 'HUBy-Mobility-Brasil/3.0 (suporte@hubymovi.com)' }
    });
    if (resGlobal.ok) {
      const lista = await resGlobal.json().catch(() => null);
      if (Array.isArray(lista) && lista.length > 0 && lista[0]) {
        const item = lista[0];
        const nomeCompleto = String(item.display_name || termoLimpo);
        const partes = nomeCompleto.split(',');
        const nomeCurto = partes.slice(0, 2).map((p) => p.trim()).join(', ');

        const latNum = parseFloat(item.lat);
        const lngNum = parseFloat(item.lon);

        if (!isNaN(latNum) && !isNaN(lngNum)) {
          return {
            nome_curto: nomeCurto || termoLimpo,
            lat: latNum,
            lng: lngNum
          };
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Erro no fallback global Nominatim:', e.message);
  }

  return null;
}

// Endpoint de Localização e Voz com IA para qualquer ponto do Brasil
router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, userLat, userLng } = req.body || {};

    console.log('🤖 [IA HUBy] Comando recebido:', { referencia, userLat, userLng });

    if (!referencia || !String(referencia).trim()) {
      return res.status(200).json({
        sucesso: false,
        erro: 'Por favor, informe ou fale o endereço de destino.'
      });
    }

    let termoFormatado = String(referencia).trim();
    let latFinal = null;
    let lngFinal = null;
    let nomeFinal = null;

    const apiKey = process.env.GEMINI_API_KEY;

    // 1. Tenta interpretar com o Gemini (se houver chave configurada)
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
2. Retorne RIGOROSAMENTE apenas um JSON no formato:
{
  "nome_curto": "Nome da Rua ou Cidade, UF",
  "termo_busca": "Nome Limpo Para Busca",
  "lat": null,
  "lng": null
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
        console.warn('⚠️ [IA Gemini] Aviso na interpretação Gemini:', errGemini.message);
      }
    }

    // 2. Geocodificação geográfica (Nominatim)
    let resultadoFinal = null;
    if (latFinal && lngFinal) {
      resultadoFinal = { nome_curto: nomeFinal, lat: latFinal, lng: lngFinal };
    } else {
      resultadoFinal = await buscarNominatimBrasil(termoFormatado, userLat, userLng);
      if (!resultadoFinal && termoFormatado !== referencia) {
        resultadoFinal = await buscarNominatimBrasil(referencia, userLat, userLng);
      }
    }

    // 3. Fallback de segurança se não encontrar nada
    if (!resultadoFinal) {
      return res.status(200).json({
        sucesso: false,
        erro: 'Não conseguimos identificar este local com precisão. Tente falar com mais detalhes (ex: rua e bairro).'
      });
    }

    console.log('✅ [HUBy Geocodificação] Destino validado no Brasil:', resultadoFinal);
    return res.status(200).json({
      sucesso: true,
      resultado: resultadoFinal
    });

  } catch (err) {
    console.error('❌ [IA] Erro capturado na rota:', err.message);
    return res.status(200).json({
      sucesso: false,
      erro: 'Falha temporária ao identificar coordenadas. Digite o endereço manualmente.'
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