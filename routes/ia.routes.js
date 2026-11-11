// routes/ia.routes.js - Geocodificação Nacional, Flash Encomendas e Cérebro Semântico do Copiloto
import express from 'express';

const router = express.Router();

const MODELOS_GEMINI = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

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
    .replace(/[_.-]+/g, ' ')
    .split(' ')[0]
    .trim();
}

async function chamarGeminiAPI(prompt, apiKey, temperatura = 0.45) {
  if (!apiKey) return null;

  for (const modelo of MODELOS_GEMINI) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperatura,
            maxOutputTokens: 350
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
// ENDPOINT 2: COPILOTO COM RACIOCÍNIO LIVRE E ZERO REPETIÇÃO
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

    const promptIA = `Você é o Copiloto de Inteligência Artificial do aplicativo HUBy. Seu nome de código atual é "${ctx.codigoVoz || 'Zanix'}".
Você está conversando por voz com o motorista ${nomeLimpo}.
Seu raciocínio é livre, lógico, natural e inteligente, igual a um humano experiente conversando no carro.

PROIBIDO REPETIR TEXTO PRONTO: Nunca repita resumo de horário + viagens + saldo a menos que o motorista pergunte especificamente por esses números! Responda SOMENTE ao assunto que ele falou, de forma direta, humana e inteligente.

ESTADO ATUAL DA TELA DO MOTORISTA:
- Horário atual: ${horaAtual}
- Nome do motorista: ${nomeLimpo}
- Status: ${ctx.statusOnline ? 'Online' : 'Offline'} | Pausa: ${ctx.emPausa ? 'Ativa' : 'Inativa'} | Mapa de Calor: ${ctx.heatmapAtivo ? 'Ligado' : 'Desligado'}
- Saldo na carteira: ${ctx.saldo || 'R$ 0,00'} | Ganhos hoje: ${ctx.ganhosHoje || 'R$ 0,00'} | Viagens hoje: ${ctx.corridasHoje || '0 viagens'}
- Chamadas no radar: ${ctx.qtdChamadasNoRadar || 0}
${ctx.primeiraChamadaRadar ? `- Pedido no radar: De "${ctx.primeiraChamadaRadar.origem}" para "${ctx.primeiraChamadaRadar.destino}", distância ${ctx.primeiraChamadaRadar.distanciaKm} km (~${ctx.primeiraChamadaRadar.duracaoMin} min), pagando R$ ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} livres.` : '- Nenhum pedido no radar.'}
${ctx.rotaEmAnalise ? `- Rota aberta no mapa em análise: De "${ctx.rotaEmAnalise.origem}" para "${ctx.rotaEmAnalise.destino}", ${ctx.rotaEmAnalise.distanciaKm} km, pagando R$ ${ctx.rotaEmAnalise.ganhoLiquidoMotorista} livres.` : ''}
${ctx.corridaAtiva ? `- Corrida em andamento (${ctx.corridaAtiva.etapa}): Destino "${ctx.corridaAtiva.destino}", ${ctx.corridaAtiva.distanciaKm} km, ganho R$ ${ctx.corridaAtiva.ganhoLiquidoMotorista}.` : ''}

HISTÓRICO RECENTE DA CONVERSA:
${historicoFormatado}

AÇÕES DISPONÍVEIS PARA VOCÊ ACIONAR NA TELA (campo "acao"):
- "VISUALIZAR_ROTA": Para abrir/ver a rota do pedido no mapa ou checar visualmente o pedido que chegou.
- "ACEITAR_CORRIDA": Para aceitar/pegar a corrida.
- "DISPENSAR_PEDIDO_RADAR": Quando ele pedir para tirar o pedido da tela, limpar o pedido, recusar ou descartar a chamada da lista.
- "CANCELAR_ROTA": Quando a rota estiver aberta em análise no mapa e ele pedir para voltar ou fechar a rota.
- "ALTERNAR_CALOR": Quando ele pedir para ativar, ligar ou desligar o mapa de calor.
- "ALTERNAR_PAUSA": Para ativar ou tirar a pausa de 15 minutos.
- "ALTERNAR_MODO_CASA": Para ativar ou desativar o filtro de rota para casa.
- "AVISAR_CHEGADA": Avisar o passageiro que chegou no local de embarque.
- "INICIAR_VIAGEM": Iniciar a corrida após o embarque.
- "FINALIZAR_CORRIDA": Concluir a corrida no destino.
- "PAGAR_DINHEIRO" | "PAGAR_MAQUININHA" | "PAGAR_PIX": Confirmar pagamento.
- "ABRIR_SAQUE": Abrir tela de saque Pix.
- "ABRIR_PERFIL": Abrir gaveta de perfil.
- "FECHAR_TELAS": Fechar janelas ou modais abertos.
- "NENHUMA": Quando for conversa, dúvida, pergunta de horário, análise de corrida ou confirmação.

O MOTORISTA FALOU AGORA:
"${falaMotorista}"

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem emojis, sem asteriscos):
{"acao": "NOME_DA_ACAO_OU_NENHUMA", "fala": "Sua resposta inteligente, variada e direta ao ponto"}`;

    if (apiKey) {
      const raw = await chamarGeminiAPI(promptIA, apiKey, 0.45);
      const parsed = extrairJSONPuro(raw);

      if (parsed && parsed.fala) {
        return res.status(200).json({
          sucesso: true,
          acao: parsed.acao || 'NENHUMA',
          resposta: String(parsed.fala).replace(/[*#_~`]/g, '').trim()
        });
      }
    }

    // Raciocínio Semântico Autônomo (Funciona mesmo sem GEMINI_API_KEY configurada no servidor)
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

// Motor de Raciocínio Lógico para entender qualquer frase natural sem repetir texto
function raciocinioSemanticoAutonomo(falaBruta, ctx, horaAtual, nome) {
  const f = String(falaBruta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. Confirmações curtas ("certo", "ok", "beleza", "valeu", "entendi", "show")
  if (/^(certo|ok|okay|beleza|blz|valeu|obrigado|entendi|show|perfeito|ta bom|tudo bem|positivo|fechou)$/.test(f)) {
    const respostasCurtas = [
      `Combinado, ${nome}! Qualquer coisa é só chamar.`,
      `Show de bola! Seguimos atentos aqui.`,
      `Beleza! Estou de olho no painel para você.`,
      `Tranquilo, parceiro! Só falar se precisar.`
    ];
    return {
      acao: 'NENHUMA',
      fala: respostasCurtas[Math.floor(Math.random() * respostasCurtas.length)]
    };
  }

  // 2. Ativar / Desativar Mapa de Calor
  if (f.includes('calor') || f.includes('demanda') || f.includes('zona quente') || f.includes('onde tem corrida')) {
    const vaiLigar = !ctx.heatmapAtivo;
    return {
      acao: 'ALTERNAR_CALOR',
      fala: vaiLigar
        ? `Ativei o mapa de calor na tela, ${nome}. As manchas laranjas mostram onde estão chamando mais agora.`
        : `Desativei o mapa de calor e deixei o mapa limpo para você.`
    };
  }

  // 3. Tirar pedido da tela / Dispensar / Recusar / Cancelar pedido do radar
  if (
    f.includes('tirar pedido') || f.includes('tira esse pedido') || f.includes('tirar esse pedido') ||
    f.includes('tira o pedido') || f.includes('tirar o pedido') || f.includes('tirar da tela') ||
    f.includes('tira da tela') || f.includes('limpa a tela') || f.includes('dispensa') ||
    f.includes('recusa') || f.includes('cancela esse pedido') || f.includes('cancelar pedido') ||
    f.includes('nao quero')
  ) {
    if (ctx.telasAbertas?.previaRota || ctx.rotaEmAnalise) {
      return {
        acao: 'CANCELAR_ROTA',
        fala: 'Fechei a prévia da rota e tirei da tela.'
      };
    }
    if (ctx.qtdChamadasNoRadar > 0) {
      return {
        acao: 'DISPENSAR_PEDIDO_RADAR',
        fala: 'Pronto, tirei esse pedido da sua tela. Aguardando uma chamada melhor.'
      };
    }
    return {
      acao: 'FECHAR_TELAS',
      fala: 'A tela já está limpa, sem nenhum pedido pendente.'
    };
  }

  // 4. Checar / Ver / Analisar pedido que acabou de chegar no radar
  if (
    f.includes('checa') || f.includes('checar') || f.includes('ve esse pedido') ||
    f.includes('ver esse pedido') || f.includes('pedido que veio') || f.includes('chamada que veio') ||
    f.includes('qual e a dessa') || f.includes('detalhes do pedido') || f.includes('fala desse pedido')
  ) {
    const p = ctx.primeiraChamadaRadar || ctx.rotaEmAnalise;
    if (p) {
      const distNum = parseFloat(p.distanciaKm || 0);
      const distTxt = distNum < 1 ? `${Math.round(distNum * 1000)} metros` : `${distNum.toFixed(1).replace('.', ',')} quilômetros`;
      return {
        acao: 'VISUALIZAR_ROTA',
        fala: `Checando agora: o embarque é em ${p.origem.split(',')[0]} indo para ${p.destino.split(',')[0]}. São ${distTxt} e paga ${p.ganhoLiquidoMotorista} reais livres. Já abri a rota no mapa para você ver!`
      };
    }
    return {
      acao: 'NENHUMA',
      fala: 'Olhei aqui no radar e não tem nenhum pedido pendente neste segundo.'
    };
  }

  // 5. Pergunta de Horário ("qual o horário agora?", "que horas são?")
  if (f.includes('qual o horario') || f.includes('que horas') || f.includes('hora agora') || f.includes('horario agora')) {
    const horaNum = parseInt(horaAtual.split(':')[0], 10);
    let dicaTurno = 'O movimento está moderado neste horário.';
    if (horaNum >= 6 && horaNum <= 9) dicaTurno = 'Estamos no pico da manhã, ótimo horário para corridas rápidas.';
    else if (horaNum >= 11 && horaNum <= 14) dicaTurno = 'Horário de almoço e saída escolar, costuma tocar bastante no centro.';
    else if (horaNum >= 17 && horaNum <= 20) dicaTurno = 'Horário de pico do fim de tarde, a demanda sobe forte agora.';
    else if (horaNum >= 15 && horaNum < 17) dicaTurno = 'Finalzinho da tarde se aproximando, daqui a pouco começa o pico das 17 horas.';

    return {
      acao: 'NENHUMA',
      fala: `Agora são ${horaAtual}, ${nome}. ${dicaTurno}`
    };
  }

  // 6. Pergunta sobre Melhor Horário para rodar
  if (f.includes('melhor horario') || f.includes('melhores horarios') || f.includes('horario bom') || f.includes('quando toca mais')) {
    return {
      acao: 'NENHUMA',
      fala: `Os três melhores picos são das 6 e meia às 8 e meia da manhã, do meio-dia às 2 da tarde, e das 17 às 20 horas. Na sexta e no sábado à noite também gira muito bem.`
    };
  }

  // 7. Pergunta se a corrida compensa / vale a pena
  if (f.includes('compensa') || f.includes('vale a pena') || f.includes('e boa') || f.includes('o que voce acha')) {
    const p = ctx.rotaEmAnalise || ctx.primeiraChamadaRadar;
    if (p) {
      const km = parseFloat(p.distanciaKm || 0.5);
      const ganho = parseFloat(String(p.ganhoLiquidoMotorista || '0').replace(',', '.'));
      const reaisPorKm = km > 0 ? (ganho / km).toFixed(2).replace('.', ',') : ganho;
      const avaliacaoCorrida = (ganho / Math.max(km, 0.3)) >= 2.0
        ? 'O ganho por quilômetro está excelente, vale muito a pena pegar!'
        : 'É uma corrida razoável para manter o giro.';
      return {
        acao: 'NENHUMA',
        fala: `Essa corrida paga ${p.ganhoLiquidoMotorista} reais livres para ${p.distanciaKm} quilômetros, dando ${reaisPorKm} reais por quilômetro. ${avaliacaoCorrida} Quer que eu aceite?`
      };
    }
    return {
      acao: 'NENHUMA',
      fala: 'Não tem nenhuma corrida aberta na tela agora, mas assim que tocar uma eu calculo na ponta do lápis se compensa!'
    };
  }

  // 8. Pergunta sobre Corridas do Dia
  if (f.includes('quantas corridas') || f.includes('quantas viagens') || f.includes('fiz hoje')) {
    return {
      acao: 'NENHUMA',
      fala: `Hoje você fez ${ctx.corridasHoje || 'zero viagens'} e somou ${ctx.ganhosHoje || 'zero reais'} livres.`
    };
  }

  // 9. Pergunta sobre Saldo / Carteira / Dinheiro
  if (f.includes('saldo') || f.includes('carteira') || f.includes('quanto eu tenho') || f.includes('quanto ganhei')) {
    return {
      acao: 'NENHUMA',
      fala: `Seu saldo atual na carteira é de ${ctx.saldo || 'zero reais'}, e os seus ganhos de hoje estão em ${ctx.ganhosHoje || 'zero reais'}.`
    };
  }

  // 10. Modo Pausa
  if (f.includes('pausa') || f.includes('descansar') || f.includes('parar um pouco') || f.includes('cafe') || f.includes('abastecer')) {
    return {
      acao: 'ALTERNAR_PAUSA',
      fala: ctx.emPausa ? 'Desativei a pausa, já voltamos a receber corridas.' : 'Ativei o modo pausa de 15 minutos para você descansar tranquilo.'
    };
  }

  // 11. Resposta conversacional aberta e inteligente (sem repetir dados decorados)
  if (ctx.primeiraChamadaRadar) {
    return {
      acao: 'NENHUMA',
      fala: `Entendi, ${nome}. Aproveitando, tem um pedido na tela pagando ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} reais. Quer que eu abra a rota ou dispense ele?`
    };
  }

  return {
    acao: 'NENHUMA',
    fala: `Estou na escuta, ${nome}. Você pode me pedir para checar pedidos, ligar o mapa de calor, analisar se uma corrida compensa ou controlar toda a viagem por aqui.`
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