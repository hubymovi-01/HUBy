// routes/ia.routes.js - Geocodificação Inteligente e Resiliente para o Piauí
import express from 'express';

const router = express.Router();

// Função auxiliar de busca geográfica progressiva (Nominatim / OSM)
async function buscarCoordenadasNominatim(termo, cidadeContexto = 'São João do Piauí') {
  try {
    // Limpeza de termos comuns de conversação
    const termoLimpo = termo
      .replace(/^(quero ir para|me leva para|me leve para|ir para|vamos para|ir ate|ir até|vou para|ir ao|me leva no|me leva na)\s+/i, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .trim();

    // Variações de busca ordenada da mais específica para a mais ampla
    const tentativas = [
      `${termoLimpo}, ${cidadeContexto}, Piauí, Brasil`,
      `${termoLimpo}, São João do Piauí, Brasil`,
      `${termoLimpo}, Piauí, Brasil`,
      `${termoLimpo}, Brasil`
    ];

    for (const query of tentativas) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'HUBy-Mobility-App/2.5 (contato@hubymovi.com)' }
      });

      if (res.ok) {
        const dados = await res.json();
        if (dados && dados.length > 0) {
          const item = dados[0];
          const nomeCurto = item.display_name.split(',').slice(0, 2).join(', ');
          return {
            nome_curto: nomeCurto,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon)
          };
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [Geocodificação Fallback] Erro:', err.message);
  }
  return null;
}

router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    console.log('🤖 [IA] Termo de busca recebido:', referencia);

    if (!referencia || !referencia.trim()) {
      return res.status(400).json({ erro: 'Por favor, fale ou informe o endereço de destino.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    let resultadoFinal = null;

    // 1. Tentar geocodificar e limpar via Gemini API com prompt refinado
    if (apiKey) {
      try {
        const prompt = `
Você é um especialista em geolocalização urbana no interior do estado do Piauí, Brasil.
Contexto / Cidade principal: ${cidadeBase}.
Destino falado pelo passageiro: "${referencia}".

Instruções:
1. Remova expressões conversacionais como "quero ir", "me leva", "vamos para".
2. Se for uma rua, praça, colégio, IFPI, hospital, terminal ou cidade vizinha (ex: João Costa, Simplício Mendes, São Raimundo Nonato, Teresina), encontre as coordenadas aproximadas mais realistas dessa região no Piauí.
3. Responda RIGOROSAMENTE apenas um JSON válido com esta estrutura exata:
{
  "nome_curto": "Nome da Rua/Local, Cidade, PI",
  "lat": -8.3582,
  "lng": -42.2476
}
`;

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
          const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const limpo = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(limpo);
            const lat = parseFloat(parsed.lat);
            const lng = parseFloat(parsed.lng);

            // Valida se as coordenadas pertencem geograficamente à região do Brasil/Piauí
            if (!isNaN(lat) && !isNaN(lng) && lat < 0 && lng < 0) {
              resultadoFinal = {
                nome_curto: parsed.nome_curto || referencia,
                lat,
                lng
              };
              console.log('✅ [IA Gemini] Coordenadas identificadas:', resultadoFinal);
            }
          }
        } else {
          console.warn('⚠️ [IA Gemini] Erro na resposta da API:', await respGemini.text());
        }
      } catch (errGemini) {
        console.warn('⚠️ [IA Gemini] Falha no modelo:', errGemini.message);
      }
    }

    // 2. Se a IA hesitou ou não encontrou, executa a busca progressiva de contingência
    if (!resultadoFinal) {
      console.log('🔄 [IA] Acionando busca geográfica de contingência para:', referencia);
      resultadoFinal = await buscarCoordenadasNominatim(referencia, 'São João do Piauí');
    }

    // 3. Resposta final ao frontend
    if (!resultadoFinal) {
      return res.status(404).json({
        erro: 'Não conseguimos identificar este local. Tente falar o nome da rua junto com o bairro ou cidade.'
      });
    }

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

// Rota de Extração Inteligente de Encomendas HUBy Flash
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

    const prompt = `
Você é um assistente de logística e entregas urbanas no Piauí, Brasil.
O cliente ditou uma ordem de entrega de encomenda: "${texto}".

Extraia as seguintes informações e retorne RIGOROSAMENTE apenas um JSON:
{
  "recebedor": "Nome e telefone de quem vai receber (ou apenas o nome se não houver telefone)",
  "tipoItem": "documento" | "pequeno" | "medio" | "fragil",
  "observacao": "Instrução adicional curta sobre o item ou entrega (se houver, senão null)"
}

Regras para tipoItem:
- "documento": cartas, papéis, envelopes, chaves, contratos.
- "pequeno": remédios, caixas pequenas, peças leves até 5kg.
- "medio": compras de mercado, caixas maiores, roupas, até 15kg.
- "fragil": bolos, copos, vidros, doces delicados.
`;

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
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const parsed = JSON.parse(rawText.trim());
        return res.json({ sucesso: true, resultado: parsed });
      }
    }

    return res.status(500).json({ erro: 'Falha ao processar dados da entrega com IA.' });
  } catch (err) {
    console.error('❌ [IA Flash] Erro:', err.message || err);
    return res.status(500).json({ erro: 'Erro interno ao processar encomenda.', detalhe: err.message });
  }
});

// Rota de Smart Replies Contextuais para o Chat do Motorista
router.post('/motorista-respostas', async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) {
      return res.status(400).json({ erro: 'Mensagem do passageiro não fornecida.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const fallbackRespostas = ['Estou a caminho!', 'Chego em 2 minutos.', 'Já cheguei no local!'];

    if (!apiKey) {
      return res.json({ sucesso: true, sugestoes: fallbackRespostas });
    }

    const prompt = `
Você é um copiloto inteligente de mobilidade urbana para o motorista parceiro da HUBy no Piauí.
O passageiro acabou de enviar a seguinte mensagem no chat: "${mensagem}".

Gere exatamente 3 sugestões de respostas ultra-curtas, profissionais e seguras para o motorista enviar com 1 toque no trânsito (máximo 6 palavras cada).
Retorne RIGOROSAMENTE apenas um JSON no formato:
{
  "sugestoes": ["Resposta 1", "Resposta 2", "Resposta 3"]
}
`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const respGemini = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    });

    if (respGemini.ok) {
      const json = await respGemini.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const parsed = JSON.parse(rawText.trim());
        if (Array.isArray(parsed.sugestoes) && parsed.sugestoes.length > 0) {
          return res.json({ sucesso: true, sugestoes: parsed.sugestoes.slice(0, 3) });
        }
      }
    }

    return res.json({ sucesso: true, sugestoes: fallbackRespostas });
  } catch (err) {
    console.warn('⚠️ [IA Motorista] Fallback aplicado:', err.message);
    return res.json({
      sucesso: true,
      sugestoes: ['Estou a caminho!', 'Chego em instantes.', 'Aguarde no local.']
    });
  }
});

export default router;