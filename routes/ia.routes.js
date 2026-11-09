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
    
    // Configura o modelo com fallback
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      Você é um assistente de geolocalização no Piauí, Brasil.
      Região de referência: ${cidadeBase}.
      Destino solicitado pelo passageiro: "${referencia}".

      Retorne APENAS um objeto JSON com as coordenadas aproximadas:
      {
        "nome_curto": "Nome do Local ou Cidade, PI",
        "lat": -8.3582,
        "lng": -42.2476
      }
    `;

    const result = await model.generateContent(prompt);
    const respostaTexto = result.response.text();
    console.log('🤖 [IA] Resposta pura:', respostaTexto);

    // Extrai o bloco JSON com expressão regular caso venha texto adicional
    const match = respostaTexto.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Formato JSON não encontrado na resposta da IA');
    }

    const dadosGeolocalizacao = JSON.parse(match[0]);

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