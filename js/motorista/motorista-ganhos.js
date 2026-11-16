// js/motorista/motorista-ganhos.js - Faturamento, Extrato, Meta e Relatório PDF (Comprovante de Renda)
import { API_URL, sonsHUBy, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';

let metaComemorada = false;

// Garante que o html2pdf.js seja carregado caso não exista no index.html
function garantirHtml2Pdf() {
  if (typeof html2pdf === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    document.head.appendChild(script);
  }
}
garantirHtml2Pdf();

export async function carregarGanhosHoje() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/ganhos-hoje`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (resp.ok) {
      const dados = await resp.json();
      estado.ganhosHoje = Number(dados.ganhosHoje || 0);
      estado.corridasHoje = Number(dados.corridasHoje || 0);
    }
  } catch (err) {
    console.warn('Aviso: endpoint ganhos-hoje ainda não respondeu, usando valores locais:', err);
  } finally {
    renderizarCardGanhosHoje();
  }
}

export function configurarAjusteMetaDiaria() {
  const modal = document.getElementById('modalMetaDiaria');
  if (modal) return; // Já gerenciado pelo modal elegante do app-motorista.js

  const btnEditarMeta = document.getElementById('btnEditarMetaDiaria');
  if (!btnEditarMeta) return;

  btnEditarMeta.addEventListener('click', (e) => {
    e.preventDefault();
    const metaAtual = estado.metaDiaria || 200;
    const novaMeta = prompt('Defina a sua meta diária de faturamento (R$):', metaAtual);
    
    if (novaMeta !== null) {
      const valorNum = parseFloat(novaMeta.replace(',', '.'));
      if (!isNaN(valorNum) && valorNum > 0) {
        estado.metaDiaria = valorNum;
        localStorage.setItem('huby_meta_diaria', valorNum);
        metaComemorada = false;
        renderizarCardGanhosHoje();
      }
    }
  });
}

export function renderizarCardGanhosHoje() {
  const lblValor = document.getElementById('lblGanhosHojeValor');
  const lblQtd = document.getElementById('lblCorridasHojeQtd');
  const barraProgresso = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  const ganhos = estado.ganhosHoje || 0;
  const meta = estado.metaDiaria || Number(localStorage.getItem('huby_meta_diaria')) || 200;
  const percentual = Math.min(Math.round((ganhos / meta) * 100), 100);

  if (lblValor) lblValor.textContent = `R$ ${ganhos.toFixed(2).replace('.', ',')}`;
  if (lblQtd) lblQtd.textContent = `${estado.corridasHoje || 0} ${estado.corridasHoje === 1 ? 'viagem' : 'viagens'}`;
  
  if (lblMetaTxt) {
    if (percentual >= 100) {
      lblMetaTxt.innerHTML = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} <strong style="color: #10B981;">(100% Batida! 🎉)</strong>`;
    } else {
      lblMetaTxt.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${percentual}%)`;
    }
  }

  if (barraProgresso) {
    barraProgresso.style.width = `${percentual}%`;
    if (percentual >= 100) {
      barraProgresso.style.background = '#10B981';
      barraProgresso.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.7)';
    } else {
      barraProgresso.style.background = '#38BDF8';
      barraProgresso.style.boxShadow = 'none';
    }
  }

  if (percentual >= 100 && !metaComemorada && ganhos > 0) {
    metaComemorada = true;
    sonsHUBy.tocarMetaBatida();
  }
}

export async function carregarExtratoFinanceiro() {
  const listaEl = document.getElementById('drawerListaExtrato');
  if (!listaEl) return;

  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    let resp = await fetch(`${API_URL}/api/motoristas/extrato`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let saques = [];
    let corridas = [];

    if (resp.ok) {
      const data = await resp.json();
      saques = Array.isArray(data.saques) ? data.saques : [];
      corridas = Array.isArray(data.corridas) ? data.corridas : [];
    } else {
      const respHistorico = await fetch(`${API_URL}/api/pedidos/historico`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (respHistorico.ok) {
        const dataHist = await respHistorico.json();
        corridas = Array.isArray(dataHist) ? dataHist : (dataHist.viagens || []);
      }
    }

    if (saques.length === 0 && corridas.length === 0) {
      listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Nenhuma movimentação registrada hoje.</div>';
      return;
    }

    const fatorMotorista = Math.max(0.1, (100 - Number(TAXA_PLATAFORMA_ATUAL ?? 15)) / 100);
    let html = '';

    saques.slice(0, 5).forEach(s => {
      const corStatus = s.status === 'pago' ? '#10B981' : (s.status === 'recusado' ? '#EF4444' : '#F59E0B');
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
          <div>
            <strong style="color: #FFF; display: block;">Saque Pix</strong>
            <small style="color: ${corStatus}; font-weight: 700; text-transform: uppercase;">${s.status}</small>
          </div>
          <span style="color: #EF4444; font-weight: 800;">- R$ ${Number(s.valor || 0).toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    corridas.slice(0, 8).forEach(c => {
      const repasse = Number(c.repasse_liquido || (Number(c.valor_total || 0) * fatorMotorista));
      const local = c.destino_endereco ? c.destino_endereco.split(',')[0].trim() : 'Viagem Concluída';
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
          <div>
            <strong style="color: #FFF; display: block;">Viagem HUBy</strong>
            <small style="color: var(--text-sec); font-size: 11px;">${local}</small>
          </div>
          <span style="color: #10B981; font-weight: 800;">+ R$ ${repasse.toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    listaEl.innerHTML = html;
  } catch (err) {
    listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Sem movimentações no período.</div>';
  }
}

// ============================================================================
// RELATÓRIO MENSAL EM PDF (COMPROVANTE DE RENDA E IMPOSTO)
// ============================================================================
async function gerarPdfRelatorioMensal() {
  if (typeof html2pdf === 'undefined') {
    notificar('Gerador PDF ainda carregando. Tente novamente em 2 segundos.', 'aviso');
    return;
  }

  const token = localStorage.getItem('huby_token');
  const dataHoje = new Date();
  // Mostra o mês atual (YYYY-MM) como padrão para a pesquisa, caso o usuário não tenha mexido no prompt
  const mesAtual = dataHoje.toISOString().slice(0, 7); 
  const mesDigitado = prompt('Deseja gerar o relatório de qual mês? (Formato AAAA-MM)', mesAtual);
  
  if (!mesDigitado) return;

  notificar('Consultando dados oficiais no sistema. Aguarde...', 'info');

  try {
    const res = await fetch(`${API_URL}/api/motoristas/relatorio-mensal?mes=${mesDigitado}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Não foi possível buscar o relatório deste mês.');
    const rel = await res.json();

    const dataEmissao = dataHoje.toLocaleString('pt-BR');
    const authCode = `HBY-${Math.random().toString(36).substr(2, 9).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    // Criar o template HTML do PDF em memória (Design Minimalista P&B focado em impressão e contabilidade)
    const divRelatorio = document.createElement('div');
    divRelatorio.style.cssText = 'padding: 40px; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1e293b; background: #FFF; line-height: 1.5; width: 700px;';
    
    let htmlViagensDiarias = '';
    if (rel.viagensDiarias && rel.viagensDiarias.length > 0) {
      htmlViagensDiarias = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 10px; text-align: left;">Data</th>
              <th style="padding: 10px; text-align: center;">Corridas Realizadas</th>
              <th style="padding: 10px; text-align: right;">Repasse Líquido (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${rel.viagensDiarias.map(v => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px;">${v.data_corrida}</td>
                <td style="padding: 10px; text-align: center;">${v.qtd}</td>
                <td style="padding: 10px; text-align: right; font-weight: bold;">R$ ${v.liquido.replace('.', ',')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      htmlViagensDiarias = `<p style="color: #64748b; font-size: 13px; text-align: center; margin-top: 20px;">Nenhuma movimentação registrada na última semana deste mês.</p>`;
    }

    divRelatorio.innerHTML = `
      <div style="border-bottom: 2px solid #10B981; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <h1 style="margin: 0; color: #0f172a; font-size: 24px; font-weight: 900;">HUBy Tecnologia e Mobilidade</h1>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 12px;">Comprovante Analítico de Rendimentos (Motorista Parceiro)</p>
        </div>
        <div style="text-align: right;">
          <strong style="color: #10B981; font-size: 32px; letter-spacing: -1px; display: block; line-height: 1;">HUBy</strong>
        </div>
      </div>

      <div style="display: flex; gap: 40px; margin-bottom: 30px;">
        <div style="flex: 1;">
          <h3 style="margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px;">Dados do Titular</h3>
          <strong style="display: block; font-size: 16px; color: #1e293b;">${rel.motorista.nome}</strong>
          <div style="font-size: 13px; color: #475569; margin-top: 4px;">CPF: ${rel.motorista.cpf}</div>
          <div style="font-size: 13px; color: #475569;">Veículo: ${rel.motorista.veiculo}</div>
        </div>
        <div style="flex: 1;">
          <h3 style="margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px;">Dados do Relatório</h3>
          <div style="font-size: 13px; color: #475569; margin-top: 4px;">Mês Referência: <strong>${rel.mesReferencia}</strong></div>
          <div style="font-size: 13px; color: #475569;">Emissão: ${dataEmissao}</div>
          <div style="font-size: 13px; color: #475569;">Autenticador: ${authCode}</div>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
        <h3 style="margin: 0 0 16px; font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; text-align: center;">Resumo Financeiro Consolidado</h3>
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 15px;">
          <span>Volume Total Recebido de Passageiros (Bruto)</span>
          <strong>R$ ${rel.resumo.faturamentoBruto.replace('.', ',')}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 15px; color: #ef4444;">
          <span>Taxa de Intermediação HUBy Plataforma</span>
          <strong>- R$ ${rel.resumo.taxaPlataforma.replace('.', ',')}</strong>
        </div>
        <div style="border-top: 1px dashed #cbd5e1; margin: 16px 0;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 16px; font-weight: bold;">Faturamento Líquido Efetivo (Repasse)</span>
          <strong style="font-size: 22px; color: #10B981;">R$ ${rel.resumo.ganhoLiquido.replace('.', ',')}</strong>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 30px; text-align: center;">
        <div>
          <small style="color: #64748b; font-size: 11px; text-transform: uppercase;">Total de Viagens</small>
          <div style="font-size: 18px; font-weight: bold; color: #0f172a;">${rel.resumo.totalViagens} corridas</div>
        </div>
        <div style="border-left: 1px solid #e2e8f0;"></div>
        <div>
          <small style="color: #64748b; font-size: 11px; text-transform: uppercase;">Distância em Serviço</small>
          <div style="font-size: 18px; font-weight: bold; color: #0f172a;">${rel.resumo.kmRodado} km</div>
        </div>
      </div>

      <h3 style="margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px;">Últimas Movimentações Diárias do Período</h3>
      ${htmlViagensDiarias}

      <div style="margin-top: 60px; font-size: 10px; color: #94a3b8; text-align: justify; line-height: 1.6;">
        <strong>Declaração:</strong> O presente relatório é gerado eletronicamente e serve como comprovante analítico dos valores repassados ao parceiro cadastrado para fins de declaração de renda (Imposto de Renda / MEI) referente aos serviços de transporte privado individual prestados. A HUBy atua estritamente como intermediadora tecnológica, sendo o motorista o único responsável pelo recolhimento de seus tributos municipais e federais decorrentes destes ganhos de acordo com sua natureza jurídica. Código de verificação interna: ${authCode}.
      </div>
    `;

    notificar('Gerando arquivo PDF. Isso levará alguns segundos...', 'info');

    const opts = {
      margin: 0.5,
      filename: `Comprovante_HUBy_${rel.mesReferencia}_${rel.motorista.nome.replace(/\s+/g, '')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opts).from(divRelatorio).save().then(() => {
      notificar('✅ PDF gerado e baixado no seu dispositivo!', 'sucesso');
    });

  } catch (err) {
    notificar(err.message, 'erro');
  }
}

// Vincula a função ao botão que já existe no HTML (drawer-nav do motorista)
document.addEventListener('DOMContentLoaded', () => {
  const btnExportar = document.getElementById('btnExportarFechamentoDia');
  if (btnExportar) {
    btnExportar.addEventListener('click', (e) => {
      e.preventDefault();
      gerarPdfRelatorioMensal();
    });
  }
});