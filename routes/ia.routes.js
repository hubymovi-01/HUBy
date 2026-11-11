// routes/ia.routes.js - Geocodificação Nacional, Flash Encomendas e Suporte por Voz Gemini
import express from 'express';

const router = express.Router();

// Função auxiliar para sanitizar retornos markdown do Gemini
function extrairJSONPuro(texto) {
  if (!texto) return null;
  const limpo = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    return null;
  }
}

// Geocodificador Nominatim flexível e tolerante no Brasil
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
      const params = `q=${encodeURIComponent(busca)}&format=json&countrycodes=br&limit=1`;
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

// Endpoint 1: Localização e Voz do Passageiro (Geocodificação Inteligente)
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
2. Se souber as coordenadas geográficas precisas dessa cidade, bairro ou ponto no Brasil, preencha os campos "lat" e "lng". Se não tiver certeza absoluta, retorne null.
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
          const parsed = extrairJSONPuro(raw);

          if (parsed) {
            if (parsed.termo_busca) termoFormatado = parsed.termo_busca;
            if (parsed.lat && parsed.lng && !isNaN(Number(parsed.lat)) && !isNaN(Number(parsed.lng))) {
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

// Endpoint 2: Suporte ao Motorista com Controle e Leitura Total da Área do App
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, contextoCompleto, contextoCorrida } = req.body || {};
    const ctx = contextoCompleto || contextoCorrida || {};

    if (!pergunta || !String(pergunta).trim()) {
      return res.status(200).json({
        sucesso: false,
        resposta: 'Não entendi sua dúvida. Pode repetir?'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback sem chave configurada
      return res.status(200).json({
        sucesso: true,
        resposta: ctx.saldo ? `Seu saldo atual é de ${ctx.saldo}.` : 'Copiloto HUBy conectado. Dirija com atenção.'
      });
    }

    const promptContexto = `Você é o copiloto de voz com CONTROLE TOTAL do aplicativo de mobilidade HUBy para motoristas parceiros no Brasil.
O motorista está no volante e falará com você por voz.
Sua resposta será sintetizada diretamente em áudio (Text-to-Speech).

DADOS REAIS EM TEMPO REAL DA ÁREA DO MOTORISTA:
- Condutor: ${ctx.nomeCondutor || 'Parceiro'}
- Status: ${ctx.statusOnline ? 'Online (Apto a receber chamadas)' : 'Offline'}
- Saldo Disponível na Carteira: ${ctx.saldo || 'R$ 0,00'}
- Ganhos Hoje: ${ctx.ganhosHoje || 'R$ 0,00'} (${ctx.corridasHoje || '0 viagens'})
- Meta Diária: ${ctx.metaDiaria || 'Não definida'}
- Veículo Cadastrado: ${ctx.veiculo || 'Não informado'}
- Avaliação: ${ctx.avaliacao || '5.0 estrelas'}
- Chamadas Disponíveis no Radar Agora: ${ctx.qtdChamadasNoRadar || 0}
${ctx.primeiraChamadaRadar ? `- Detalhes da Chamada no Radar: Destino para ${ctx.primeiraChamadaRadar.destino}, valor de repasse R$ ${ctx.primeiraChamadaRadar.repasse}, distância ${ctx.primeiraChamadaRadar.dist} km, duração aproximada ${ctx.primeiraChamadaRadar.dur} min.` : ''}

PERGUNTA FEITA POR VOZ PELO MOTORISTA:
"${pergunta}"

INSTRUÇÕES RIGOROSAS:
1. Responda em no máximo 1 ou 2 frases curtas, claras e naturais para fala.
2. NUNCA use pontuações de markdown como asteriscos (*), travessões, cerquilhas (#) ou emojis, pois serão lidos pelo sintetizador de voz.
3. Use os dados reais acima para responder sobre saldo, dinheiro, ganhos do dia, veículo, placa, chamadas ou rota atual.
4. Se o motorista perguntar sobre taxa: o repasse da HUBy para ele é de 85% do valor total da viagem.`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptContexto }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 90
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const textoResposta = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (textoResposta && textoResposta.trim()) {
        const falaLimpa = textoResposta.replace(/[*#_~`]/g, '').trim();
        return res.status(200).json({ sucesso: true, resposta: falaLimpa });
      }
    }

    return res.status(200).json({
      sucesso: true,
      resposta: 'Copiloto conectado. Como posso ajudar com sua rota ou saldo?'
    });

  } catch (err) {
    console.error('❌ [IA Suporte] Falha:', err.message);
    return res.status(200).json({
      sucesso: true,
      resposta: 'Estou monitorando seu trajeto. Pode falar o comando.'
    });
  }
});

// Endpoint 3: Extração Inteligente de Encomendas HUBy Flash
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
      const parsed = extrairJSONPuro(txt);
      if (parsed) {
        return res.json({ sucesso: true, resultado: parsed });
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

// Endpoint 4: Smart Replies Contextuais para o Motorista
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
      const parsed = extrairJSONPuro(txt);
      if (parsed && Array.isArray(parsed.sugestoes)) {
        return res.json({ sucesso: true, sugestoes: parsed.sugestoes.slice(0, 3) });
      }
    }
    return res.json({ sucesso: true, sugestoes: fallback });
  } catch (err) {
    return res.json({ sucesso: true, sugestoes: fallback });
  }
});

export default router;