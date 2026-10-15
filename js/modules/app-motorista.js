/**
 * ============================================================================
 * HUBy - Controlador Funcional do Painel do Motorista (js/modules/app-motorista.js)
 * ============================================================================
 */

import { ApiClient } from '../services/api-client.js';

document.addEventListener('DOMContentLoaded', () => {
  // Verifica chamadas pendentes a cada 2 segundos
  verificarChamadasPendentes();
  setInterval(verificarChamadasPendentes, 2000);

  // Botão Aceitar Chamada
  document.getElementById('btnAceitar').addEventListener('click', () => {
    const corrida = ApiClient.atualizarStatusCorrida('motorista_a_caminho');
    if (corrida) {
      alert(`✅ Corrida #${corrida.id.slice(0, 6)} aceite! O navegador será redirecionado para a rota.`);
      window.location.href = './index.html';
    }
  });

  // Botão Recusar Chamada
  document.getElementById('btnRecusar').addEventListener('click', () => {
    ApiClient.limparCorridaAtiva();
    document.getElementById('cardChamadaAtiva').style.display = 'none';
    document.getElementById('radarAviso').style.display = 'flex';
  });
});

function verificarChamadasPendentes() {
  const corrida = ApiClient.obterCorridaAtiva();
  const card = document.getElementById('cardChamadaAtiva');
  const radar = document.getElementById('radarAviso');

  if (corrida && corrida.status === 'buscando_motorista') {
    // Esconde o radar e mostra o card com a chamada a tocar
    radar.style.display = 'none';
    card.style.display = 'block';

    const orc = corrida.orcamento;
    
    // Preenche os dados financeiros e de trajeto no painel do motorista
    document.getElementById('lblCatChamada').innerText = orc.categoria;
    document.getElementById('lblPgtoChamada').innerText = corrida.formaPagamento === 'dinheiro_presencial' ? '💵 Dinheiro / Pix Direto' : '💠 Pix App (Split)';
    document.getElementById('lblGanhoLiquido').innerText = formatarMoeda(orc.ganhoLiquidoMotorista);
    document.getElementById('lblValorBase').innerText = formatarMoeda(orc.valorBase);
    document.getElementById('lblValorExtras').innerText = '+ ' + formatarMoeda(orc.valorAdicionais);
    document.getElementById('lblTextoComissao').innerText = `Comissão HUBy (${orc.comissaoPercentual}%):`;
    document.getElementById('lblValorComissao').innerText = '- ' + formatarMoeda(orc.valorComissaoPlataforma);
    document.getElementById('lblOrigemCorrida').innerText = corrida.origemEndereco;
    document.getElementById('lblDestinoCorrida').innerText = corrida.destinoEndereco;
  }
}

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor).toFixed(2).replace('.', ',');
}