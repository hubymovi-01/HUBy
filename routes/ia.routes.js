// routes/ia.routes.js - Geocodificação Nacional e Copiloto com Consciência de Corrida
import express from 'express';

const router = express.Router();

function extrairJSONPuro(texto) {
  if (!texto) return null;
  const limpo = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    return null;
  }
}

// Geocodificador Nominatim flexível no Brasil
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

// Endpoint 1: Localização e Voz do Passageiro
router.post('/localizar-referencia', async (req, res) => {
  try {
    const { referencia, userLat, userLng } = req.body || {};

    if (!referencia || !String(referencia).trim()) {
      return res.status(200).json({ sucesso: false, erro: 'Informe o endereço de destino.' });
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

        const prompt = `Você é o geocodificador inteligente do aplicativo HUBy no Brasil.
${contextoGPS}
Destino falado: "${referencia}".

Instruções:
1. Extraia o nome real do local.
2. Preencha "lat" e "lng" apenas com certeza absoluta, caso contrário use null.
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
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
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
        console.warn('Fallback direto para Nominatim:', errGemini.message);
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
      return res.status(200).json({ sucesso: false, erro: 'Local não identificado com precisão.' });
    }

    return res.status(200).json({ sucesso: true, resultado: resultadoFinal });
  } catch (err) {
    return res.status(200).json({ sucesso: false, erro: 'Falha ao processar localização.' });
  }
});

// Endpoint 2: Mente Situacional do Copiloto (Conversa e Execução Dinâmica)
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, contextoCompleto, historicoConversa } = req.body || {};
    const ctx = contextoCompleto || {};

    if (!pergunta || !String(pergunta).trim()) {
      return res.status(200).json({
        sucesso: false,
        acao: 'NENHUMA',
        resposta: 'Pode falar, parceiro.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        sucesso: true,
        acao: 'NENHUMA',
        resposta: ctx.saldo ? `Saldo atual: ${ctx.saldo}.` : 'Copiloto operacional.'
      });
    }

    const promptMente = `Você é o copiloto de inteligência artificial de bordo do motorista no HUBy.
Sua postura é a de um co-piloto profissional, humano, atento e direto. Você não repete frases prontas de robô nem lê opções como menu de telefone.
Você CONVERSA com o motorista de forma natural, mas ESTREITAMENTE FOCADA em assuntos da corrida, direção, rota, valores, trânsito e decisões operacionais.

ESTADO VIVO DO APLICATIVO AGORA:
- Motorista: ${ctx.nomeCondutor || 'Parceiro'}
- Conexão: ${ctx.statusOnline ? 'Online (Aguardando/em rota)' : 'Offline'}
- Saldo: ${ctx.saldo || 'R$ 0,00'}
- Produção Hoje: ${ctx.ganhosHoje || 'R$ 0,00'} (${ctx.corridasHoje || '0 corridas'})
- Chamadas Disponíveis no Radar: ${ctx.qtdChamadasNoRadar || 0}
- Prévia de Rota Aberta na Tela: ${ctx.telasAbertas?.previaRota ? 'SIM (A rota está desenhada na tela aguardando aceite ou rejeição)' : 'NÃO'}
- Viagem Ativa em Andamento: ${ctx.corridaAtivaId ? 'SIM (Passageiro a bordo ou a caminho)' : 'NÃO'}
${ctx.primeiraChamadaRadar ? `- Chamada no Radar: Destino para ${ctx.primeiraChamadaRadar.destino}, ganho líquido de R$ ${ctx.primeiraChamadaRadar.repasse}, distância ${ctx.primeiraChamadaRadar.dist} km, tempo estimado ${ctx.primeiraChamadaRadar.dur} min.` : ''}

AÇÕES DISPONÍVEIS NA INTERFACE:
- "VISUALIZAR_ROTA": Quando o motorista demonstrar curiosidade sobre o trajeto, pedir para olhar o mapa ou avaliar a corrida pendente.
- "ACEITAR_CORRIDA": Quando ele decidir pegar a corrida (ex: "vamos fazer", "pega", "pode aceitar", "fechou", "aceita logo").
- "CANCELAR_ROTA": Quando ele rejeitar, quiser voltar pro radar, desistir da prévia ou mandar fechar o trajeto.
- "AVISAR_CHEGADA": Quando ele disser que encostou, chegou no passageiro ou tá no portão.
- "INICIAR_VIAGEM": Quando o passageiro entrar e ele mandar rodar, dar a partida ou começar a corrida.
- "FINALIZAR_CORRIDA": Quando chegar ao destino final e for hora de acertar o valor.
- "ABRIR_SAQUE": Se ele quiser retirar dinheiro ou ver a tela do Pix.
- "ABRIR_PERFIL": Se pedir pra ver dados cadastrais ou preferências.
- "FECHAR_TELAS": Voltar pra tela limpa do mapa.
- "NENHUMA": Apenas responde com raciocínio, tirando dúvidas sobre km, valores, se vale a pena a corrida, etc.

MENSAGEM DO MOTORISTA:
"${pergunta}"

DIRETRIZES DE RESPOSTA:
1. Responda em JSON puro:
{
  "acao": "NOME_DA_ACAO",
  "fala": "Sua resposta com voz natural humana. Máximo 1 ou 2 frases enxutas. Sem asteriscos, sem emojis e sem traços."
}
2. Responda de igual para igual, demonstrando raciocínio situacional imediato.
3. Se ele fizer perguntas analíticas (ex: "Vale a pena pegar essa?", "Quantos km dá?"), analise os dados do radar e dê uma opinião prática de trânsito.`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptMente }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 110,
          responseMimeType: 'application/json'
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = extrairJSONPuro(raw);

      if (parsed && parsed.fala) {
        return res.status(200).json({
          sucesso: true,
          acao: parsed.acao || 'NENHUMA',
          resposta: parsed.fala.replace(/[*#_~`]/g, '').trim()
        });
      }
    }

    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Estou monitorando o trajeto com você.'
    });

  } catch (err) {
    console.error('Falha no copiloto:', err.message);
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Copiloto a postos. Pode comandar.'
    });
  }
});

// Endpoint 3: Extração Flash
router.post('/flash-extrair', async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(200).json({ sucesso: false, erro: 'Instrução não informada.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        sucesso: true,
        resultado: { recebedor: 'A informar', tipoItem: 'pequeno', observacao: texto }
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
      const parsed = extrairJSONPuro(data?.candidates?.[0]?.content?.parts?.[0]?.text);
      if (parsed) return res.json({ sucesso: true, resultado: parsed });
    }

    return res.status(200).json({
      sucesso: true,
      resultado: { recebedor: 'A informar', tipoItem: 'pequeno', observacao: texto }
    });
  } catch (err) {
    return res.status(200).json({ sucesso: false, erro: err.message });
  }
});

// Endpoint 4: Respostas Rápidas
router.post('/motorista-respostas', async (req, res) => {
  const fallback = ['Estou a caminho!', 'Chego em 2 minutos.', 'Já cheguei no local!'];
  try {
    const { mensagem } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !mensagem) return res.json({ sucesso: true, sugestoes: fallback });

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
      const parsed = extrairJSONPuro(data?.candidates?.[0]?.content?.parts?.[0]?.text);
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