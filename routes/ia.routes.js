// routes/ia.routes.js - Geocodificação Inteligente via Gemini
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

router.post('/localizar-referencia', autenticarToken, async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    if (!referencia) {
      return res.status(400).json({ erro: 'Por favor, informe o ponto de referência.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ erro: 'Serviço de IA indisponível no momento.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      Atue como um geocodificador especialista na região de ${cidadeBase} e arredores no Piauí.
      O passageiro disse ou digitou a seguinte referência de destino: "${referencia}".
      Pode ser um endereço local, um estabelecimento, um bairro OU uma cidade vizinha (como Simplício Mendes, etc.).
      Identifique o local exato ou mais provável e devolva APENAS um JSON válido.
      Não adicione formatação markdown, nem texto extra, apenas o JSON puro com esta estrutura:
      {
        "nome_curto": "Nome do Local ou Cidade (Ex: Simplício Mendes, PI)",
        "lat": latitude_em_numero,
        "lng": longitude_em_numero
      }
    `;

    const result = await model.generateContent(prompt);
    const textoLimpo = result.response.text().replace(/```json|```/g, '').trim();
    
    const dadosGeolocalizacao = JSON.parse(textoLimpo);

    res.json({
      sucesso: true,
      resultado: dadosGeolocalizacao
    });

  } catch (err) {
    console.error('Falha na resolução de morada via IA:', err);
    res.status(500).json({ 
      erro: 'Não foi possível encontrar a localização exata por esta referência. Pode dar mais algum detalhe?' 
    });
  }
});

export default router;