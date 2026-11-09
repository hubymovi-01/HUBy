// routes/ia.routes.js - Geocodificação Inteligente via Gemini
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    console.log('🤖 [IA] Pedido recebido para referência:', referencia);

    if (!referencia) {
      return res.status(400).json({ erro: 'Por favor, informe o ponto de referência.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ [IA] GEMINI_API_KEY não definida nas variáveis de ambiente do Render.');
      return res.status(500).json({ erro: 'Chave GEMINI_API_KEY ausente no servidor.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      Atue como um geocodificador especialista na região de ${cidadeBase} e arredores no estado do Piauí.
      O passageiro indicou o seguinte destino: "${referencia}".
      Pode ser uma rua, estabelecimento, praça, bairro ou cidade vizinha (como Simplício Mendes, São Raimundo Nonato, etc.).
      Identifique as coordenadas mais prováveis e devolva RIGOROSAMENTE apenas um JSON válido, sem blocos de código Markdown nem texto explicativo:
      {
        "nome_curto": "Nome do Local ou Cidade, PI",
        "lat": latitude_numero,
        "lng": longitude_numero
      }
    `;

    const result = await model.generateContent(prompt);
    const respostaTexto = result.response.text();
    console.log('🤖 [IA] Resposta bruta Gemini:', respostaTexto);

    const textoLimpo = respostaTexto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const dadosGeolocalizacao = JSON.parse(textoLimpo);

    console.log('✅ [IA] Coordenadas calculadas:', dadosGeolocalizacao);

    return res.json({
      sucesso: true,
      resultado: dadosGeolocalizacao
    });

  } catch (err) {
    console.error('❌ [IA] Erro detalhado no processamento:', err.message || err);
    return res.status(500).json({ 
      erro: 'Não foi possível encontrar a localização com essa referência.',
      detalhe: err.message
    });
  }
});

export default router;