// routes/ia.routes.js - Geocodificação Nacional, Flash Encomendas e Copiloto Cognitivo Gemini
import express from 'express';

const router = express.Router();

function extrairJSONPuro(texto) {
  if (!texto) return null;
  const limpo = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
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
    return res.status(200).json({
      sucesso: false,
      erro: 'Falha temporária ao processar a localização.'
    });
  }
});

// Endpoint 2: Mente Cognitiva do Copiloto (Raciocínio Livre no Nicho de Mobilidade)
router.post('/motorista-suporte', async (req, res) => {
  try {
    const { pergunta, intencaoLimpa, contextoCompleto, contextoCorrida } = req.body || {};
    const ctx = contextoCompleto || contextoCorrida || {};
    const falaMotorista = intencaoLimpa || pergunta || '';

    if (!falaMotorista || !String(falaMotorista).trim()) {
      return res.status(200).json({
        sucesso: false,
        acao: 'NENHUMA',
        resposta: 'Estou na escuta, parceiro.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        sucesso: true,
        acao: 'NENHUMA',
        resposta: ctx.saldo ? `Seu saldo na carteira é ${ctx.saldo}.` : 'Copiloto ativo no trajeto.'
      });
    }

    const promptCognitivo = `Você é a Inteligência Artificial Copiloto de Bordo do aplicativo HUBy para motoristas profissionais.
Você tem mente própria, raciocínio analítico e consciência em tempo real de tudo o que acontece na tela do motorista.
Converse como um parceiro experiente sentado no banco do carona: natural, ágil, inteligente e focado no universo de corridas, rotas, faturamento, segurança e operação do aplicativo.

RAIO-X EM TEMPO REAL DA TELA DO MOTORISTA:
- Motorista: ${ctx.nomeCondutor || 'Parceiro'} (${ctx.avaliacao || '5.0'})
- Veículo: ${ctx.veiculo || 'Cadastrado'}
- Status: ${ctx.statusOnline ? 'Online' : 'Offline'} | Em Pausa: ${ctx.emPausa ? 'Sim' : 'Não'} | Modo Casa: ${ctx.modoCasaAtivo ? 'Ativo' : 'Inativo'}
- Saldo Disponível (Carteira): ${ctx.saldo || 'R$ 0,00'}
- Ganhos de Hoje: ${ctx.ganhosHoje || 'R$ 0,00'} (${ctx.corridasHoje || '0 viagens'}) | Meta: ${ctx.metaDiaria || 'R$ 200,00'}
- Chamadas Pendentes no Radar: ${ctx.qtdChamadasNoRadar || 0}
${ctx.primeiraChamadaRadar ? `- Chamada #1 no Radar: Buscar em "${ctx.primeiraChamadaRadar.origem}" -> Levar para "${ctx.primeiraChamadaRadar.destino}". Distância: ${ctx.primeiraChamadaRadar.distanciaKm} km (~${ctx.primeiraChamadaRadar.duracaoMin} min). Ganho líquido (85%): R$ ${ctx.primeiraChamadaRadar.ganhoLiquidoMotorista} (Valor total: R$ ${ctx.primeiraChamadaRadar.valorBruto}).` : '- Nenhuma chamada esperando no radar.'}
${ctx.rotaEmAnalise ? `- ROTA ABERTA EM ANÁLISE NO MAPA AGORA: De "${ctx.rotaEmAnalise.origem}" para "${ctx.rotaEmAnalise.destino}", ${ctx.rotaEmAnalise.distanciaKm} km (~${ctx.rotaEmAnalise.duracaoMin} min), ganho líquido R$ ${ctx.rotaEmAnalise.ganhoLiquidoMotorista}. Aguardando o motorista mandar aceitar ou voltar/cancelar.` : ''}
${ctx.corridaAtiva ? `- CORRIDA ACEITA EM ANDAMENTO: Fase atual = "${ctx.corridaAtiva.etapa === 'a_caminho' ? 'Indo buscar o passageiro no embarque' : 'Em viagem levando o passageiro ao destino'}". Origem: "${ctx.corridaAtiva.origem}", Destino: "${ctx.corridaAtiva.destino}", Distância: ${ctx.corridaAtiva.distanciaKm} km, Ganho líquido: R$ ${ctx.corridaAtiva.ganhoLiquidoMotorista}.` : ''}
- Modal de Pagamento Final Aberto: ${ctx.telasAbertas?.modalLiquidacaoPagamento ? 'SIM (Aguardando escolher Dinheiro, Maquininha ou Pix)' : 'NÃO'}

COMANDOS DE CONTROLE QUE VOCÊ PODE DISPARAR NA TELA (campo "acao"):
- "VISUALIZAR_ROTA": Abre o mapa com o traçado da chamada pendente do radar.
- "ACEITAR_CORRIDA": Aceita a corrida (seja da prévia aberta ou direto do radar).
- "CANCELAR_ROTA": Fecha a prévia da rota, volta pro radar ou recusa/dispensa a chamada.
- "AVISAR_CHEGADA": Notifica o passageiro que o motorista encostou no embarque.
- "INICIAR_VIAGEM": Inicia a corrida quando o passageiro entra no veículo.
- "FINALIZAR_CORRIDA": Abre a tela de encerramento/recebimento ao chegar no destino.
- "PAGAR_DINHEIRO": Liquida a corrida em espécie.
- "PAGAR_MAQUININHA": Liquida a corrida na maquininha de cartão.
- "PAGAR_PIX": Gera o QR Code Pix do Mercado Pago na tela.
- "ABRIR_SAQUE": Abre o modal de saque Pix da carteira.
- "ABRIR_PERFIL": Abre o menu lateral do motorista.
- "ABRIR_EDICAO_PERFIL": Abre o modal de editar dados e foto do perfil.
- "ABRIR_CHAT": Abre o chat com o passageiro.
- "ABRIR_LOJA": Abre o HUBy Clube de descontos e loja.
- "ALTERNAR_CALOR": Liga ou desliga o mapa de calor de demanda.
- "ALTERNAR_PAUSA": Ativa ou desativa a pausa de 15 minutos.
- "ALTERNAR_MODO_CASA": Ativa ou desativa o filtro de corridas para casa.
- "EXPORTAR_FECHAMENTO": Baixa o relatório de fechamento diário.
- "FICAR_OFFLINE": Desconecta o motorista.
- "FICAR_ONLINE": Conecta o motorista.
- "FECHAR_TELAS": Fecha modais ou gavetas abertas.
- "NENHUMA": Quando for uma pergunta informativa, cálculo de ganho por km, conselho se a corrida compensa ou bate-papo de trânsito.

O QUE O MOTORISTA ACABOU DE FALAR:
"${falaMotorista}"

REGRAS DE OURO:
1. Retorne APENAS um objeto JSON válido:
{
  "acao": "CODIGO_DA_ACAO_OU_NENHUMA",
  "fala": "Sua resposta natural falada (1 a 2 frases diretas, sem asteriscos, sem markdown e sem emojis)."
}
2. Se o motorista perguntar se a corrida compensa ou pedir análise, calcule mentalmente a relação R$/km usando os dados reais acima e dê sua recomendação sincera de parceiro.
3. Se o motorista pedir algo fora do nicho de mobilidade/trânsito/corridas, traga a conversa de volta para a pista com bom humor e foco profissional.`;

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptCognitivo }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 130,
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
          resposta: String(parsed.fala).replace(/[*#_~`]/g, '').trim()
        });
      }
    }

    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Tô na escuta acompanhando sua rota.'
    });

  } catch (err) {
    console.error('❌ [IA Suporte] Falha:', err.message);
    return res.status(200).json({
      sucesso: true,
      acao: 'NENHUMA',
      resposta: 'Copiloto ativo no painel. Pode mandar o comando.'
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
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = extrairJSONPuro(txt);
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