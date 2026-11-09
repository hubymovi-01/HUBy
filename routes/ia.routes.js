// routes/ia.routes.js - Geocodificação Inteligente via Gemini
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    console.log('🤖 [IA] Pedido recebido para:', referencia);

    if (!referencia) {
      return res.status(400).json({ erro: 'Por favor, informe o ponto de referência.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ [IA] GEMINI_API_KEY em falta no Render.');
      return res.status(500).json({ erro: 'Chave GEMINI_API_KEY ausente no servidor.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      Você é um assistente especialista em geolocalização no estado do Piauí, Brasil.
      Cidade base operacional: ${cidadeBase}.
      Destino falado/digitado pelo passageiro: "${referencia}".

      Identifique o local exato ou a cidade informada (ex: Simplício Mendes, Teresina, São Raimundo Nonato, bairros ou praças locais).
      Retorne RIGOROSAMENTE apenas um JSON no formato:
      {
        "nome_curto": "Nome Claro do Local, Cidade - PI",
        "lat": -8.3582,
        "lng": -42.2476
      }
    `;

    const result = await model.generateContent(prompt);
    const respostaTexto = result.response.text();
    console.log('🤖 [IA] Resposta bruta Gemini:', respostaTexto);

    let dadosGeolocalizacao;
    try {
      dadosGeolocalizacao = JSON.parse(respostaTexto);
    } catch (e) {
      const match = respostaTexto.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Formato JSON não encontrado na resposta da IA');
      dadosGeolocalizacao = JSON.parse(match[0]);
    }

    dadosGeolocalizacao.lat = parseFloat(dadosGeolocalizacao.lat);
    dadosGeolocalizacao.lng = parseFloat(dadosGeolocalizacao.lng);

    if (isNaN(dadosGeolocalizacao.lat) || isNaN(dadosGeolocalizacao.lng)) {
      throw new Error('Coordenadas retornadas inválidas.');
    }

    return res.json({
      sucesso: true,
      resultado: dadosGeolocalizacao
    });

  } catch (err) {
    console.error('❌ [IA] Falha no processamento:', err.message || err);
    return res.status(500).json({ 
      erro: 'Não foi possível identificar a localização.',
      detalhe: err.message
    });
  }
});

export default router;