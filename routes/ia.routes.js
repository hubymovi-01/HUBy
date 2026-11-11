// routes/ia.routes.js - Geocodificação Nacional, Flash Encomendas e Copiloto Conversacional Gemini
import express from 'express';

const router = express.Router();

// Modelos oficiais ativos da API Gemini (ordem de prioridade com fallback automático)
const MODELOS_GEMINI = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest'
];

// Extrai JSON mesmo que o modelo envie texto ou blocos markdown ao redor
function extrairJSONPuro(texto) {
  if (!texto) return null;
  const limpo = String(texto).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (err) { return null; }
    }
    return null;
  }
}

// Chama a API Gemini testando automaticamente os modelos ativos
async function chamarGeminiAPI(prompt, apiKey, modoJSON = true, temperatura = 0.4) {
  if (!apiKey) return null;

  for (const modelo of MODELOS_GEMINI) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
      const generationConfig = {
        temperature: temperatura,
        maxOutputTokens: 450
      };
      if (modoJSON) {
        generationConfig.responseMimeType = 'application/json';
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        })
      });

      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText && rawText.trim()) {
          return rawText.trim();
        }
      }
    } catch (err) {
      console.warn(`⚠️ Tentativa com modelo ${modelo} falhou:`, err.message);
    }
  }
  return null;
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

// ============================================================================
// ENDPOINT 1: LOCALIZAÇÃO E VOZ DO PASSAGEIRO
// ============================================================================
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
      const contextoGPS = (userLat && userLng)
        ? `O passageiro está próximo a lat: ${userLat}, lng: ${userLng} no estado do Piauí / Brasil.`
        : 'O passageiro está no Brasil, região do Piauí.';

      const prompt = `Você é o geocodificador inteligente do aplicativo de mobilidade HUBy no Brasil.
${contextoGPS}
O passageiro falou o destino: "${referencia}".

Extraia o nome real do local e retorne APENAS um JSON no formato:
{
  "nome_curto": "Nome do Local ou Cidade, UF",
  "termo_busca": "Nome Limpo Para Busca",
  "lat": -8.3582 ou null,
  "lng": -42.2476 ou null
}`;

      const raw = await chamarGeminiAPI(prompt, apiKey, true, 0.1);
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
        erro: 'Não conseguimos identificar este local com precisão. Tente falar com mais detalhes.'
      });
    }

    return res.status(200).json({
      sucesso: true,
      resultado: resultadoFinal
    });

  } catch (err) {
    return res.status(200).json({
      sucesso: false,
      erro: 'Falha temporária ao processar a localização.'
    });
  }
});

// ============================================================================
// ENDPOINT 2: COPILOTO CONVERSACIONAL COM INTERAÇÃO LIVRE E COMANDOS DE TELA
// ============================================================================
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, intencaoLimpa, contextoCompleto, historicoConversa } = req.body || {};
    const ctx = contextoCompleto || {};
    const falaMotorista = intencaoLimpa || pergunta || '';

    if (!falaMotorista || !String(falaMotorista).trim()) {
      return res.status(200).json({
        sucesso: true,
        acao: 'NENHUMA',
        resposta: 'Fala comigo, parceiro! O que você manda?'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const horaAtual = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const historicoFormatado = Array.isArray(historicoConversa) && historicoConversa.length > 0
      ? historicoConversa.map(h => `Motorista: "${h.motorista}" | Você respondeu: "${h.ia}"`).join('\n')
      : 'Início da conversa.';

    const promptConversacional = `Você é o Copiloto de Inteligência Artificial do aplicativo HUBy, um parceiro inteligente, carismático, prestativo e articulado que conversa com o motorista enquanto ele trabalha.
Você NÃO é limitado nem robótico. Você conversa de verdade, responde perguntas, dá dicas estratégicas, analisa corridas, tira dúvidas, troca ideia e também executa comandos na tela quando o motorista pede.

HORÁRIO ATUAL NO BRASIL: ${horaAtual}

DADOS REAIS DA TELA DO MOTORISTA NESTE EXATO SEGUNDO:
- Nome do Motorista: ${ctx.nomeCondutor || 'Parceiro'} (Nota: ${ctx.avaliacao || '5.0'})
- Veículo: ${ctx.veiculo || 'Veículo cadastrado'}
- Status no App: ${ctx.statusOnline ? 'Online' : 'Offline'} | Modo Pausa: ${ctx.emPausa ? 'Ativado' : 'Desativado'} | Modo Ir p/ Casa: ${ctx.modoCasaAtivo ? 'Ativado' : 'Desativado'}
- Saldo Disponível na Carteira: ${ctx.saldo || 'R$ 0,00'}
- Ganhos de Hoje: ${ctx.ganhosHoje || 'R$ 0,00'}
- Quantidade de Corridas Feitas Hoje: ${ctx.corridasHoje || '0 viagens'}
- Meta Diária: ${ctx.metaDiaria || 'R$ 200,00'}
- Chamadas Pendentes no Radar Agora: ${ctx.qtdChamadasNoRadar || 0}
${ctx.primeiraChamadaRadar ? `- Chamada Disponível no Radar: Buscar em "${ctx.primeiraChamadaRadar.origem}" para "${ctx.primeiraChamadaRadar.destino}". Distância: ${ctx.primeiraChamadaRadar.distanciaKm} km (~${ctx.primeiraChamadaRadar.duracaoMin} min). Ganho líquido do motorista (85%): R$ ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista}.` : '- Nenhuma chamada no radar neste instante.'}
${ctx.rotaEmAnalise ? `- ROTA ABERTA NA TELA EM ANÁLISE: Origem "${ctx.rotaEmAnalise.origem}" -> Destino "${ctx.rotaEmAnalise.destino}", Distância: ${ctx.rotaEmAnalise.distanciaKm} km (~${ctx.rotaEmAnalise.duracaoMin} min), Ganho líquido: R$ ${ctx.rotaEmAnalise.ganhoLiquidoMotorista}.` : ''}
${ctx.corridaAtiva ? `- CORRIDA EM ANDAMENTO: Etapa = "${ctx.corridaAtiva.etapa === 'a_caminho' ? 'Indo buscar passageiro' : 'Passageiro a bordo rumo ao destino'}". Destino: "${ctx.corridaAtiva.destino}", Distância: ${ctx.corridaAtiva.distanciaKm} km, Ganho líquido: R$ ${ctx.corridaAtiva.ganhoLiquidoMotorista}.` : ''}

HISTÓRICO RECENTE DA CONVERSA:
${historicoFormatado}

AÇÕES QUE VOCÊ PODE EXECUTAR NA TELA (use apenas se o motorista pedir para fazer uma ação):
- "VISUALIZAR_ROTA": Mostrar/abrir a rota da chamada no mapa.
- "ACEITAR_CORRIDA": Aceitar/confirmar a corrida.
- "CANCELAR_ROTA": Cancelar, fechar a prévia da rota, voltar para o radar ou recusar a chamada.
- "AVISAR_CHEGADA": Avisar que chegou no local de embarque.
- "INICIAR_VIAGEM": Iniciar a viagem com o passageiro.
- "FINALIZAR_CORRIDA": Finalizar/concluir a corrida no destino.
- "PAGAR_DINHEIRO" | "PAGAR_MAQUININHA" | "PAGAR_PIX": Confirmar forma de pagamento.
- "ABRIR_SAQUE": Abrir modal de saque Pix.
- "ABRIR_PERFIL": Abrir menu lateral do perfil.
- "ABRIR_EDICAO_PERFIL": Abrir edição de dados e foto.
- "ABRIR_CHAT": Abrir chat com o passageiro.
- "ABRIR_LOJA": Abrir loja/clube de vantagens HUBy.
- "ALTERNAR_CALOR": Ativar/desativar mapa de calor.
- "ALTERNAR_PAUSA": Ativar/desativar modo pausa.
- "ALTERNAR_MODO_CASA": Ativar/desativar modo ir para casa.
- "EXPORTAR_FECHAMENTO": Baixar fechamento do dia.
- "FICAR_OFFLINE" | "FICAR_ONLINE": Mudar status online/offline.
- "FECHAR_TELAS": Fechar janelas ou menus abertos.
- "NENHUMA": Use "NENHUMA" quando o motorista estiver conversando, fazendo perguntas sobre corridas, melhores horários, ganhos, metas, dicas ou batendo papo.

FALA ATUAL DO MOTORISTA:
"${falaMotorista}"

INSTRUÇÕES OBRIGATÓRIAS:
1. Responda como um amigo e copiloto inteligente conversando por voz: seja natural, prestativo, responda exatamente o que ele perguntou e, quando fizer sentido, faça uma pergunta curta ou sugestão de volta para manter o diálogo vivo!
2. Não use emojis, asteriscos (*) ou hashtags (#), pois o texto será falado em voz alta pelo celular.
3. Responda SEMPRE em JSON válido no formato:
{
  "acao": "NOME_DA_ACAO_OU_NENHUMA",
  "fala": "Sua resposta conversacional completa, natural e inteligente (2 a 3 frases fluidas)."
}`;

    if (apiKey) {
      const raw = await chamarGeminiAPI(promptConversacional, apiKey, true, 0.45);
      const parsed = extrairJSONPuro(raw);

      if (parsed && parsed.fala) {
        return res.status(200).json({
          sucesso: true,
          acao: parsed.acao || 'NENHUMA',
          resposta: String(parsed.fala).replace(/[*#_~`]/g, '').trim()
        });
      }

      // Se o Gemini respondeu em texto puro sem JSON, aproveita o próprio texto
      if (raw && !raw.startsWith('{')) {
        return res.status(200).json({
          sucesso: true,
          acao: 'NENHUMA',
          resposta: String(raw).replace(/[*#_~`]/g, '').trim()
        });
      }
    }

    // Motor Conversacional Inteligente Nativo (caso o servidor esteja sem GEMINI_API_KEY configurada)
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: gerarRespostaConversacionalNativa(falaMotorista, ctx, horaAtual)
    });

  } catch (err) {
    console.error('❌ [IA Suporte] Erro:', err.message);
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Estou aqui com você, parceiro! Pode me perguntar sobre suas corridas, ganhos ou melhores horários.'
    });
  }
});

// Resposta conversacional rica no servidor caso a chave da API externa não esteja definida
function gerarRespostaConversacionalNativa(fala, ctx, horaAtual) {
  const f = String(fala || '').toLowerCase();

  if (f.includes('melhor horario') || f.includes('melhores horarios') || f.includes('horario bom') || f.includes('pico') || f.includes('movimento')) {
    return `Os melhores horários para faturar alto são das 6 e meia às 9 da manhã, no horário de almoço entre 11 e meia e 2 da tarde, e no fim do expediente das 17 às 20 horas. Nos fins de semana, a noite a partir das 19 horas também bomba! Quer que eu ative o mapa de calor para vermos onde tem demanda agora?`;
  }
  if (f.includes('quantas corridas') || f.includes('quantas viagens')) {
    return `Hoje você realizou ${ctx.corridasHoje || 'zero viagens'} até agora, acumulando ${ctx.ganhosHoje || 'zero reais'} de ganho líquido. Sua meta diária está em ${ctx.metaDiaria || 'duzentos reais'}. Vamos buscar a próxima?`;
  }
  if (f.includes('quanto ganhei') || f.includes('meus ganhos') || f.includes('faturei')) {
    return `Seus ganhos de hoje estão em ${ctx.ganhosHoje || 'zero reais'} com ${ctx.corridasHoje || 'zero viagens'}, e seu saldo disponível na carteira é de ${ctx.saldo || 'zero reais'}. Lembre que no HUBy você fica com 85 por cento livre de cada corrida!`;
  }
  if (f.includes('saldo') || f.includes('carteira')) {
    return `Você tem ${ctx.saldo || 'zero reais'} disponíveis na carteira para saque via Pix. Se quiser transferir agora, é só me dizer para abrir o saque!`;
  }
  if (f.includes('compensa') || f.includes('vale a pena') || f.includes('boa essa')) {
    const alvo = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (alvo) {
      const km = parseFloat(alvo.distanciaKm || 1);
      const ganho = parseFloat(String(alvo.ganhoLiquidoMotorista || '0').replace(',', '.'));
      const porKm = km > 0 ? (ganho / km).toFixed(2).replace('.', ',') : ganho;
      return `Olha, essa corrida paga ${alvo.ganhoLiquidoMotorista} reais livres para rodar ${alvo.distanciaKm} quilômetros, o que dá cerca de ${porKm} reais por quilômetro. É um tiro curto e rápido, vale a pena pegar! Quer que eu aceite?`;
    }
    return `No momento não tem nenhuma chamada aberta na tela para eu calcular o ganho por quilômetro, mas assim que tocar uma eu já analiso para você!`;
  }
  return `Tô aqui com você, ${ctx.nomeCondutor || 'parceiro'}! Agora são ${horaAtual}, você está com ${ctx.corridasHoje || '0 viagens'} hoje e ${ctx.saldo || 'R$ 0,00'} na carteira. O que você quer saber ou fazer agora?`;
}

// ============================================================================
// ENDPOINT 3: EXTRAÇÃO INTELIGENTE DE ENCOMENDAS HUBY FLASH
// ============================================================================
router.post('/flash-extrair', async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(200).json({ sucesso: false, erro: 'Texto de instrução não fornecido.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const prompt = `Extraia dados da ordem de entrega no Brasil: "${texto}".
Retorne APENAS um JSON:
{
  "recebedor": "Nome e telefone",
  "tipoItem": "documento" | "pequeno" | "medio" | "fragil",
  "observacao": "Instrução curta ou null"
}`;
      const raw = await chamarGeminiAPI(prompt, apiKey, true, 0.2);
      const parsed = extrairJSONPuro(raw);
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

// ============================================================================
// ENDPOINT 4: SMART REPLIES CONTEXTUAIS PARA O MOTORISTA
// ============================================================================
router.post('/motorista-respostas', async (req, res) => {
  const fallback = ['Estou a caminho!', 'Chego em 2 minutos.', 'Já cheguei no local!'];
  try {
    const { mensagem } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && mensagem) {
      const prompt = `Gere exatamente 3 sugestões curtas de resposta no trânsito para o motorista à mensagem: "${mensagem}".
Retorne APENAS um JSON: {"sugestoes": ["...", "...", "..."]}`;
      const raw = await chamarGeminiAPI(prompt, apiKey, true, 0.3);
      const parsed = extrairJSONPuro(raw);
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