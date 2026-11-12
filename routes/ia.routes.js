// routes/ia.routes.js - Geocodificação Nacional, Flash Encomendas e Cérebro Semântico do Copiloto
import express from 'express';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

const MODELOS_GEMINI = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

router.use(autenticarToken);

const usoPorUsuario = new Map();
setInterval(() => {
  const agora = Date.now();
  for (const [chave, reg] of usoPorUsuario) {
    if (reg.reinicia <= agora) usoPorUsuario.delete(chave);
  }
}, 60_000).unref();

router.use((req, res, next) => {
  const chave = String(req.usuario?.id || req.ip);
  const agora = Date.now();
  const reg = usoPorUsuario.get(chave);

  if (!reg || reg.reinicia <= agora) {
    usoPorUsuario.set(chave, { n: 1, reinicia: agora + 60_000 });
    return next();
  }

  reg.n += 1;
  if (reg.n > 30) {
    return res.status(429).json({ sucesso: false, erro: 'Muitas solicitações. Aguarde um instante.' });
  }
  next();
});

function limparTextoPrompt(t, max = 80) {
  return String(t ?? '').replace(/["\\\n\r`{}]/g, ' ').slice(0, max).trim();
}

function sanitizarContexto(c) {
  const limparRota = (r) => (r ? {
    ...r,
    origem: limparTextoPrompt(r.origem),
    destino: limparTextoPrompt(r.destino),
    etapa: limparTextoPrompt(r.etapa, 30)
  } : r);

  return {
    ...c,
    nomeCondutor: limparTextoPrompt(c.nomeCondutor, 40),
    codigoVoz: limparTextoPrompt(c.codigoVoz, 30),
    primeiraChamadaRadar: limparRota(c.primeiraChamadaRadar),
    rotaEmAnalise: limparRota(c.rotaEmAnalise),
    corridaAtiva: limparRota(c.corridaAtiva)
  };
}

const ACOES_PERMITIDAS = new Set([
  'VISUALIZAR_ROTA', 'ACEITAR_CORRIDA', 'DISPENSAR_PEDIDO_RADAR', 'CANCELAR_ROTA',
  'ALTERNAR_CALOR', 'ALTERNAR_PAUSA', 'ALTERNAR_MODO_CASA', 'AVISAR_CHEGADA',
  'INICIAR_VIAGEM', 'FINALIZAR_CORRIDA', 'PAGAR_DINHEIRO', 'PAGAR_MAQUININHA',
  'PAGAR_PIX', 'ABRIR_SAQUE', 'ABRIR_PERFIL', 'ABRIR_EDICAO_PERFIL', 'ABRIR_CHAT',
  'ABRIR_LOJA', 'DEFINIR_META', 'EXPORTAR_FECHAMENTO', 'FICAR_ONLINE', 'FICAR_OFFLINE',
  'FECHAR_TELAS', 'NENHUMA'
]);

const FRASE_EXIGIDA = {
  ACEITAR_CORRIDA: /aceit|pega|bora|confirm|fazer|fechou|quero/,
  INICIAR_VIAGEM: /inici|comec|embarc|bora|partiu|entrou|rodar/,
  FINALIZAR_CORRIDA: /finaliz|encerr|conclu|termin|chegamos|destino/,
  PAGAR_DINHEIRO: /dinheiro|especie|mao/,
  PAGAR_MAQUININHA: /maquin|cartao|credito|debito/,
  PAGAR_PIX: /pix|qr/,
  ABRIR_SAQUE: /saq|retir|transfer|pix/,
  FICAR_ONLINE: /online|conect|comec|trabalh|ligar/,
  FICAR_OFFLINE: /offline|desconect|sair|parar|encerr|deslig/
};

function validarAcao(acao, fala) {
  const nome = String(acao || 'NENHUMA').trim().toUpperCase();
  if (!ACOES_PERMITIDAS.has(nome)) return 'NENHUMA';

  const exigida = FRASE_EXIGIDA[nome];
  if (exigida) {
    const f = String(fala || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!exigida.test(f)) return 'NENHUMA';
  }
  return nome;
}

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

function limparNomeParaFala(nomeBruto = '') {
  return String(nomeBruto || 'parceiro')
    .replace(/_cs$/i, '')
    .replace(/\s+c$/i, '')
    .replace(/[_.-]+/g, ' ')
    .split(' ')[0]
    .trim();
}

async function chamarGeminiAPI(prompt, apiKey, temperatura = 0.45) {
  if (!apiKey) return null;

  for (const modelo of MODELOS_GEMINI) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperatura,
            maxOutputTokens: 600,
            ...(modelo.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
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
      console.warn(`Tentativa com ${modelo} falhou:`, err.message);
    }
  }
  return null;
}

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
    } catch (e) {}
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
Retorne APENAS um JSON válido no formato:
{"nome_curto": "Nome do Local, UF", "termo_busca": "Nome Limpo", "lat": null, "lng": null}`;

      const raw = await chamarGeminiAPI(prompt, apiKey, 0.1);
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
        erro: 'Não conseguimos identificar este local com precisão.'
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
// ENDPOINT 2: COPILOTO COM RACIOCÍNIO LIVRE E CONTROLE TOTAL DA TELA
// ============================================================================
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, intencaoLimpa, contextoCompleto, historicoConversa } = req.body || {};
    const ctx = sanitizarContexto(contextoCompleto || {});
    const falaMotorista = intencaoLimpa || pergunta || '';

    if (!falaMotorista || !String(falaMotorista).trim()) {
      return res.status(200).json({
        sucesso: true,
        acao: 'NENHUMA',
        resposta: 'Pode falar, estou ouvindo.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const agora = new Date();
    const horaAtual = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const nomeLimpo = limparNomeParaFala(ctx.nomeCondutor);

    const historicoFormatado = Array.isArray(historicoConversa) && historicoConversa.length > 0
      ? historicoConversa.map(h => `Motorista: "${h.motorista}" -> Você: "${h.ia}"`).join('\n')
      : 'Sem mensagens anteriores.';

    const promptIA = `Você é "${ctx.codigoVoz || 'Jarvis'}", o copiloto de inteligência artificial do aplicativo HUBy, conversando por voz com o motorista ${nomeLimpo}.

PERSONALIDADE: você é comunicativo, simpático, inteligente e parceiro. Conversa sobre qualquer assunto que o motorista quiser e também executa qualquer comando na tela do aplicativo quando ele pedir.

ESTILO DE VOZ: respostas curtas e naturais para serem faladas, no máximo 2 a 3 frases, sem listas, sem emojis e sem asteriscos. Nunca repita frases padrão.

ESTADO ATUAL DA TELA DO MOTORISTA:
- Horário atual: ${horaAtual}
- Nome do motorista: ${nomeLimpo}
- Status: ${ctx.statusOnline ? 'Online' : 'Offline'} | Pausa: ${ctx.emPausa ? 'Ativa' : 'Inativa'} | Mapa de Calor: ${ctx.heatmapAtivo ? 'Ligado' : 'Desligado'}
- Saldo na carteira: ${ctx.saldo || 'R$ 0,00'} | Ganhos hoje: ${ctx.ganhosHoje || 'R$ 0,00'} | Viagens hoje: ${ctx.corridasHoje || '0 viagens'} | Meta: ${ctx.metaDiaria || 'R$ 200,00'}
- Chamadas no radar: ${ctx.qtdChamadasNoRadar || 0}
${ctx.primeiraChamadaRadar ? `- Pedido no radar: De "${ctx.primeiraChamadaRadar.origem}" para "${ctx.primeiraChamadaRadar.destino}", distância ${ctx.primeiraChamadaRadar.distanciaKm} km (~${ctx.primeiraChamadaRadar.duracaoMin} min), pagando R$ ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} livres.` : '- Nenhum pedido no radar.'}
${ctx.rotaEmAnalise ? `- Rota aberta no mapa em análise: De "${ctx.rotaEmAnalise.origem}" para "${ctx.rotaEmAnalise.destino}", ${ctx.rotaEmAnalise.distanciaKm} km, pagando R$ ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} livres.` : ''}
${ctx.corridaAtiva ? `- Corrida em andamento (${ctx.corridaAtiva.etapa}): Destino "${ctx.corridaAtiva.destino}", ${ctx.corridaAtiva.distanciaKm} km, ganho R$ ${ctx.corridaAtiva.ganhoLiquidoMotorista}.` : ''}

HISTÓRICO RECENTE DA CONVERSA:
${historicoFormatado}

AÇÕES QUE VOCÊ PODE ACIONAR NA TELA (campo "acao"):
- "VISUALIZAR_ROTA": abrir a rota do pedido no mapa.
- "ACEITAR_CORRIDA": aceitar a corrida.
- "DISPENSAR_PEDIDO_RADAR": tirar, recusar ou descartar o pedido da lista.
- "CANCELAR_ROTA": fechar a rota que está aberta em análise.
- "ALTERNAR_CALOR": ligar ou desligar o mapa de calor.
- "ALTERNAR_PAUSA": ativar ou tirar a pausa de 15 minutos.
- "ALTERNAR_MODO_CASA": ativar ou desativar o filtro de rota para casa ("ir para casa").
- "AVISAR_CHEGADA": avisar o passageiro que chegou ao embarque.
- "INICIAR_VIAGEM": iniciar a corrida depois do embarque.
- "FINALIZAR_CORRIDA": concluir a corrida no destino.
- "PAGAR_DINHEIRO" | "PAGAR_MAQUININHA" | "PAGAR_PIX": confirmar a forma de pagamento.
- "ABRIR_SAQUE": solicitar saque Pix / abrir tela de saque.
- "ABRIR_PERFIL": abrir o menu do perfil.
- "ABRIR_EDICAO_PERFIL": editar dados e foto do perfil.
- "ABRIR_CHAT": abrir o chat com o passageiro.
- "ABRIR_LOJA": abrir a HUBy Loja / Clube de descontos.
- "DEFINIR_META": abrir definição de meta diária.
- "EXPORTAR_FECHAMENTO": exportar o resumo do dia.
- "FICAR_ONLINE" | "FICAR_OFFLINE": entrar ou sair do modo online para corridas.
- "FECHAR_TELAS": fechar janelas e menus abertos.
- "NENHUMA": quando for conversa, dúvida, opinião ou análise.

O MOTORISTA FALOU AGORA:
"${falaMotorista}"

Retorne APENAS um JSON válido neste formato exato:
{"acao": "NOME_DA_ACAO_OU_NENHUMA", "fala": "Sua resposta natural e curta"}`;

    if (apiKey) {
      const raw = await chamarGeminiAPI(promptIA, apiKey, 0.45);
      const parsed = extrairJSONPuro(raw);

      if (parsed && parsed.fala) {
        return res.status(200).json({
          sucesso: true,
          acao: validarAcao(parsed.acao, falaMotorista),
          resposta: String(parsed.fala).replace(/[*#_~`]/g, '').trim()
        });
      }
    }

    const decisao = raciocinioSemanticoAutonomo(falaMotorista, ctx, horaAtual, nomeLimpo);
    return res.status(200).json({
      sucesso: true,
      acao: decisao.acao,
      resposta: decisao.fala
    });

  } catch (err) {
    console.error('Erro no suporte de IA:', err.message);
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Entendido, parceiro. Pode mandar o próximo comando.'
    });
  }
});

// Motor de Raciocínio Lógico Completo no Servidor
function raciocinioSemanticoAutonomo(falaBruta, ctx, horaAtual, nome) {
  const f = String(falaBruta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (/^(certo|ok|okay|beleza|blz|valeu|obrigado|entendi|show|perfeito|ta bom|tudo bem|positivo|fechou)$/.test(f)) {
    return { acao: 'NENHUMA', fala: `Combinado, ${nome}!` };
  }

  if (f.includes('ficar offline') || f.includes('fica offline') || f.includes('desconectar') || f === 'offline') {
    return { acao: 'FICAR_OFFLINE', fala: `Pronto, ${nome}! Coloquei você offline para corridas.` };
  }

  if (f.includes('ficar online') || f.includes('fica online') || f.includes('conectar') || f === 'online') {
    return { acao: 'FICAR_ONLINE', fala: `Você está online para receber corridas, ${nome}!` };
  }

  if (f.includes('loja') || f.includes('clube') || f.includes('desconto') || f.includes('vantagens')) {
    return { acao: 'ABRIR_LOJA', fala: `Abri a HUBy Loja e Clube de Vantagens na sua tela, ${nome}!` };
  }

  if (f.includes('ir para casa') || f.includes('ir pra casa') || f.includes('modo casa') || f.includes('modo destino')) {
    return { acao: 'ALTERNAR_MODO_CASA', fala: `Acionei o modo ir para casa na sua tela, ${nome}.` };
  }

  if (f.includes('editar dados') || f.includes('editar foto') || f.includes('dados e foto') || f.includes('editar perfil')) {
    return { acao: 'ABRIR_EDICAO_PERFIL', fala: `Abri a tela de editar dados e foto do perfil, ${nome}.` };
  }

  if (f.includes('abrir perfil') || f.includes('abrir menu') || f.includes('meu perfil')) {
    return { acao: 'ABRIR_PERFIL', fala: `Menu do motorista aberto na tela, ${nome}.` };
  }

  if (f.includes('definir meta') || f.includes('mudar meta') || f.includes('alterar meta')) {
    return { acao: 'DEFINIR_META', fala: `Abri a configuração de meta diária na tela, ${nome}.` };
  }

  if (f.includes('solicitar saque') || f.includes('saque pix') || f.includes('abrir saque') || f.includes('sacar')) {
    return { acao: 'ABRIR_SAQUE', fala: `Abri a tela de solicitação de saque Pix, ${nome}.` };
  }

  if (f.includes('calor') || f.includes('demanda') || f.includes('zona quente')) {
    return {
      acao: 'ALTERNAR_CALOR',
      fala: !ctx.heatmapAtivo ? `Ativei o mapa de calor na tela, ${nome}.` : `Desativei o mapa de calor.`
    };
  }

  if (f.includes('pausa') || f.includes('descansar') || f.includes('cafe') || f.includes('abastecer')) {
    return {
      acao: 'ALTERNAR_PAUSA',
      fala: ctx.emPausa ? 'Desativei a pausa, já voltamos a receber corridas.' : 'Ativei o modo pausa de 15 minutos para você descansar tranquilo.'
    };
  }

  if (
    f.includes('tirar pedido') || f.includes('tira esse pedido') || f.includes('tirar da tela') ||
    f.includes('dispensa') || f.includes('recusa') || f.includes('cancelar') || f.includes('voltar')
  ) {
    if (ctx.telasAbertas?.previaRota || ctx.rotaEmAnalise) {
      return { acao: 'CANCELAR_ROTA', fala: 'Fechei a prévia da rota.' };
    }
    if (ctx.qtdChamadasNoRadar > 0) {
      return { acao: 'DISPENSAR_PEDIDO_RADAR', fala: 'Pronto, tirei esse pedido da sua tela.' };
    }
    return { acao: 'FECHAR_TELAS', fala: 'Janela fechada.' };
  }

  if (f.includes('checa') || f.includes('visualizar') || f.includes('ver rota') || f.includes('mostrar rota')) {
    const p = ctx.primeiraChamadaRadar || ctx.rotaEmAnalise;
    if (p) {
      return {
        acao: 'VISUALIZAR_ROTA',
        fala: `Abri a rota no mapa! De ${p.origem.split(',')[0]} para ${p.destino.split(',')[0]}, pagando R$ ${p.ganhoLiquidoMotorista}.`
      };
    }
    return { acao: 'NENHUMA', fala: 'Não há nenhum pedido pendente no radar agora.' };
  }

  if (f.includes('qual o horario') || f.includes('que horas') || f.includes('hora agora')) {
    return { acao: 'NENHUMA', fala: `Agora são ${horaAtual}, ${nome}.` };
  }

  if (f.includes('melhor horario') || f.includes('melhores horarios')) {
    return {
      acao: 'NENHUMA',
      fala: `Os melhores picos são das 6 e meia às 9 da manhã, do meio-dia às 2 da tarde, e das 17 às 20 horas.`
    };
  }

  if (f.includes('compensa') || f.includes('vale a pena')) {
    const p = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (p) {
      return {
        acao: 'NENHUMA',
        fala: `Essa corrida paga R$ ${p.ganhoLiquidoMotorista} livres para ${p.distanciaKm} km. Quer que eu aceite?`
      };
    }
    return { acao: 'NENHUMA', fala: 'Nenhuma corrida na tela no momento para eu avaliar.' };
  }

  if (f.includes('quantas corridas') || f.includes('quantas viagens') || f.includes('fiz hoje')) {
    return { acao: 'NENHUMA', fala: `Hoje você fez ${ctx.corridasHoje || 'zero viagens'} e somou ${ctx.ganhosHoje || 'zero reais'}.` };
  }

  if (f.includes('saldo') || f.includes('carteira') || f.includes('quanto ganhei')) {
    return { acao: 'NENHUMA', fala: `Seu saldo atual na carteira é de ${ctx.saldo || 'zero reais'}, e seus ganhos de hoje estão em ${ctx.ganhosHoje || 'zero reais'}.` };
  }

  return {
    acao: 'NENHUMA',
    fala: `Na escuta, ${nome}! Como posso te ajudar agora?`
  };
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
{"recebedor": "Nome e telefone", "tipoItem": "pequeno", "observacao": "Instrução curta"}`;
      const raw = await chamarGeminiAPI(prompt, apiKey, 0.2);
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
      const raw = await chamarGeminiAPI(prompt, apiKey, 0.3);
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