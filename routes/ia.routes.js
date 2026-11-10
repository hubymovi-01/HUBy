// routes/ia.routes.js - Geocodificação Robusta com Tratamento Inteligente de Comandos de Voz
import express from 'express';

const router = express.Router();

// Função auxiliar para consultar o serviço geográfico com coordenadas reais
async function geocodificarFallback(termo, cidadeBase) {
  try {
    const termosLimpos = termo
      .replace(/^(quero ir para|me leva para|me leve para|ir para|vamos para|ir ate|ir até|vou para)\s+/i, '')
      .trim();

    const buscas = [
      `${termosLimpos}, ${cidadeBase}`,
      `${termosLimpos}, Piauí, Brasil`,
      `${termosLimpos}, Brasil`
    ];

    for (const query of buscas) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'HUBy-Mobility/2.0' } });
      if (res.ok) {
        const dados = await res.json();
        if (dados && dados.length > 0) {
          return {
            nome_curto: dados[0].display_name.split(',')[0] + ', PI',
            lat: parseFloat(dados[0].lat),
            lng: parseFloat(dados[0].lon)
          };
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Falha no fallback geográfico:', err.message);
  }
  return null;
}

router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, cidadeBase = 'São João do Piauí, Piauí' } = req.body;

    console.log('🤖 [IA] Comando de voz recebido:', referencia);

    if (!referencia || !referencia.trim()) {
      return res.status(400).json({ erro: 'Por favor, informe o ponto de referência ou destino.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    let resultadoFinal = null;

    // 1. Tentar resolver e limpar com Gemini (via REST direta para evitar conflitos de SDK)
    if (apiKey) {
      try {
        const prompt = `
Você é um assistente de GPS e geolocalização no Piauí, Brasil.
Região base: ${cidadeBase}.
O passageiro falou o seguinte comando de voz: "${referencia}".

Sua tarefa:
1. Extraia apenas o DESTINO pretendido (remova frases como "quero ir para", "me leva", "vamos até", etc.).
2. Identifique o município ou ponto de interesse real no estado do Piauí (ex: Simplício Mendes, Teresina, São João do Piauí, João Costa, praça, bairro, etc.).
3. Devolva RIGOROSAMENTE apenas um JSON no formato:
{
  "nome_curto": "Nome Limpo do Local ou Cidade, PI",
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
            if (!isNaN(lat) && !isNaN(lng)) {
              resultadoFinal = {
                nome_curto: parsed.nome_curto || referencia,
                lat,
                lng
              };
              console.log('✅ [IA Gemini] Sucesso:', resultadoFinal);
            }
          }
        } else {
          console.warn('⚠️ [IA Gemini] Erro na API:', await respGemini.text());
        }
      } catch (errGemini) {
        console.warn('⚠️ [IA Gemini] Exceção no processamento do modelo:', errGemini.message);
      }
    }

    // 2. Se a IA falhou, aplicar fallback geográfico imediato
    if (!resultadoFinal) {
      console.log('🔄 [IA] Acionando geocodificação direta para garantir o destino...');
      resultadoFinal = await geocodificarFallback(referencia, cidadeBase);
    }

    if (!resultadoFinal) {
      return res.status(404).json({
        erro: 'Não conseguimos localizar esse destino. Diga o nome da cidade, praça ou rua.'
      });
    }

    return res.json({
      sucesso: true,
      resultado: resultadoFinal
    });

  } catch (err) {
    console.error('❌ [IA] Erro geral na rota:', err);
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

    // Respostas padrão de contingência caso a API não esteja acessível
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