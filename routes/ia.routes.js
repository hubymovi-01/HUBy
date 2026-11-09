// routes/ia.routes.js - Geocodificação Robusta via Gemini REST API
import express from 'express';

const router = express.Router();

router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    console.log('🤖 [IA] Pedido recebido para:', referencia);

    if (!referencia || !referencia.trim()) {
      return res.status(400).json({ erro: 'Por favor, informe o ponto de referência.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    let dadosGeolocalizacao = null;

    // 1. Tentativa via Gemini API (REST nativo sem depender de versão de SDK)
    if (apiKey) {
      try {
        const prompt = `Atue como um geocodificador no Piauí, Brasil. 
Região de referência: ${cidadeBase}.
Destino do passageiro: "${referencia}".
Retorne APENAS um JSON no formato exato:
{"nome_curto": "Nome do Local, PI", "lat": -8.3582, "lng": -42.2476}`;

        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const respostaGemini = await fetch(urlGemini, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (respostaGemini.ok) {
          const geminiJson = await respostaGemini.json();
          const texto = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
          if (texto) {
            const parsed = JSON.parse(texto.trim());
            const lat = parseFloat(parsed.lat);
            const lng = parseFloat(parsed.lng);
            if (!isNaN(lat) && !isNaN(lng)) {
              dadosGeolocalizacao = {
                nome_curto: parsed.nome_curto || referencia,
                lat,
                lng
              };
            }
          }
        } else {
          console.warn('⚠️ [IA] Erro na resposta da API Gemini:', await respostaGemini.text());
        }
      } catch (errGemini) {
        console.warn('⚠️ [IA] Falha na consulta Gemini, aplicando fallback:', errGemini.message);
      }
    }

    // 2. Fallback de Geocodificação Direta (Garante que nunca falhe caso a IA hesite)
    if (!dadosGeolocalizacao) {
      console.log('🌐 [IA] Executando busca geográfica de contingência para:', referencia);
      const queryBusca = encodeURIComponent(`${referencia}, Piauí, Brasil`);
      const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&q=${queryBusca}&limit=1`;

      const respGeo = await fetch(urlGeo, {
        headers: { 'User-Agent': 'HUBy-App/2.0' }
      });

      if (respGeo.ok) {
        const resultados = await respGeo.json();
        if (resultados && resultados.length > 0) {
          dadosGeolocalizacao = {
            nome_curto: resultados[0].display_name.split(',')[0] + ', PI',
            lat: parseFloat(resultados[0].lat),
            lng: parseFloat(resultados[0].lon)
          };
        }
      }
    }

    if (!dadosGeolocalizacao) {
      return res.status(404).json({
        erro: 'Não foi possível identificar as coordenadas deste local. Tente detalhar um pouco mais.'
      });
    }

    console.log('✅ [IA] Sucesso:', dadosGeolocalizacao);
    return res.json({
      sucesso: true,
      resultado: dadosGeolocalizacao
    });

  } catch (err) {
    console.error('❌ [IA] Erro geral na rota:', err);
    return res.status(500).json({
      erro: 'Falha temporária ao processar a localização.',
      detalhe: err.message
    });
  }
});

export default router;