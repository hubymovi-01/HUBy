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

// Endpoint 2: Cérebro Situacional do Motorista (Raciocínio Livre focado em Mobilidade)
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, contextoCompleto } = req.body || {};
    const ctx = contextoCompleto || {};

    if (!pergunta || !String(pergunta).trim()) {
      return res.status(200).json({
        sucesso: false,
        acao: 'NENHUMA',
        resposta: 'Na escuta, parceiro.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        sucesso: true,
        acao: 'NENHUMA',
        resposta: ctx.saldo ? `Seu saldo atual é de ${ctx.saldo}.` : 'Copiloto operacional.'
      });
    }

    const promptNichoMobilidade = `Você é o co-piloto de inteligência artificial de bordo do motorista no aplicativo HUBy Mobilidade.
Você tem raciocínio livre situacional, fala como um parceiro de cabine experiente e entende gírias, contrações e intenções reais do trânsito.
Seu foco é 100% voltado para corridas, passageiros, trânsito, ganhos, rotas e direção segura.

ESTADO EM TEMPO REAL DO APLICATIVO DO MOTORISTA:
- Condutor: ${ctx.nomeCondutor || 'Parceiro'}
- Status: ${ctx.statusOnline ? 'Online (Aguardando chamadas)' : 'Offline'}
- Saldo Carteira: ${ctx.saldo || 'R$ 0,00'}
- Produção Hoje: ${ctx.ganhosHoje || 'R$ 0,00'} (${ctx.corridasHoje || '0 corridas'})
- Chamadas Disponíveis no Radar Agora: ${ctx.qtdChamadasNoRadar || 0}
- Prévia de Rota Aberta na Tela: ${ctx.telasAbertas?.previaRota ? 'SIM (A rota está visível na tela aguardando aceite ou cancelamento)' : 'NÃO'}
- Viagem Ativa em Andamento: ${ctx.corridaAtivaId ? 'SIM (Em atendimento)' : 'NÃO'}
${ctx.primeiraChamadaRadar ? `- Chamada no Radar: Destino para ${ctx.primeiraChamadaRadar.destino}, repasse de R$ ${ctx.primeiraChamadaRadar.repasse}, distância ${ctx.primeiraChamadaRadar.dist} km, duração ${ctx.primeiraChamadaRadar.dur} min.` : ''}

AÇÕES DE CONTROLE NA INTERFACE:
- "VISUALIZAR_ROTA": Quando o condutor demonstrar interesse em ver o mapa, rota ou trajeto da chamada.
- "ACEITAR_CORRIDA": Quando ele quiser pegar, aceitar, fazer ou fechar a corrida.
- "CANCELAR_ROTA": Quando ele rejeitar, mandar fechar, cancelar, voltar ou descartar a rota.
- "AVISAR_CHEGADA": Quando disser que encostou, chegou no ponto ou está no local de embarque.
- "INICIAR_VIAGEM": Quando o passageiro embarcar e ele mandar rodar, dar a partida ou partir.
- "FINALIZAR_CORRIDA": Ao chegar no destino e for hora de receber ou encerrar.
- "ABRIR_SAQUE": Abrir a tela de retirada Pix.
- "ABRIR_PERFIL": Abrir gaveta lateral de configurações.
- "FECHAR_TELAS": Fechar modais ou menus abertos.
- "NENHUMA": Apenas conversar, responder dúvidas (km, dinheiro, se compensa, dicas de trânsito).

FALA DO MOTORISTA: "${pergunta}"

DIRETRIZES:
1. Retorne RIGOROSAMENTE apenas um JSON:
{
  "acao": "NOME_DA_ACAO",
  "fala": "Resposta falada natural e direta de 1 frase (máximo 2 curtas). Proibido usar emojis, asteriscos ou caracteres especiais."
}
2. Se o motorista fizer perguntas opinativas sobre a corrida (ex: "Vale a pena pegar essa?", "É longe?"), raciocine sobre o valor de repasse e a quilometragem da chamada ativa e responda de forma prática.`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptNichoMobilidade }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 100,
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
      resposta: 'Copiado, sigo acompanhando a rota.'
    });

  } catch (err) {
    console.error('Falha na IA:', err.message);
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Copiloto ativo no trajeto.'
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