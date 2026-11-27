// js/motorista/motorista-carteira.js - Saque Pix e Fechamento do Dia
// O servidor confere dono da carteira e saldo; aqui só validamos para dar uma resposta rápida.
import { API_URL, sonsHUBy } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { carregarPerfil } from './motorista-perfil.js';
import { notificar } from '../util/alertas-huby.js';

let sacandoAgora = false;

function reais(valor) {
  const n = Number(valor);
  return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;
}

// Célula de CSV segura: entre aspas e sem virar fórmula ao abrir no Excel
function celulaCsv(valor) {
  let s = String(valor ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Fechamento do dia em CSV (abre no Excel / Planilhas)
export function exportarResumoDia() {
  const hoje = new Date();
  const dataHoje = hoje.toLocaleDateString('pt-BR');
  const taxa = Number(estado.taxaHubyMotorista);
  const pctLiquido = Number.isFinite(taxa) ? Math.max(1, 100 - taxa) : null;

  const linhas = [
    ['Campo', 'Valor'],
    ['Data', dataHoje],
    ['Motorista', estado.motoristaNome || 'Motorista'],
    ['Viagens concluídas hoje', Number(estado.corridasHoje || 0)],
    [`Ganho líquido hoje${pctLiquido ? ` (${pctLiquido}% de repasse)` : ''}`, reais(estado.ganhosHoje)],
    ['Saldo disponível na carteira', reais(estado.saldoCarteira)],
    ['Emitido em', hoje.toLocaleString('pt-BR')]
  ];

  const csv = '\uFEFF' + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `HUBy_Fechamento_${dataHoje.replace(/\//g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notificar('📄 Fechamento do dia baixado.', 'sucesso');
}

// Validação básica da chave conforme o tipo escolhido
function validarChavePix(tipo, chave) {
  const digitos = chave.replace(/\D/g, '');
  if (tipo === 'cpf') return digitos.length === 11 ? null : 'CPF deve ter 11 números.';
  if (tipo === 'telefone') return digitos.length >= 10 && digitos.length <= 13 ? null : 'Telefone inválido (use DDD + número).';
  if (tipo === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave) && chave.length <= 120 ? null : 'E-mail inválido.';
  if (tipo === 'aleatoria') return /^[0-9a-fA-F-]{32,36}$/.test(chave) ? null : 'Chave aleatória inválida.';
  return 'Tipo de chave inválido.';
}

export function configurarEventosSaque() {
  const modalSaque = document.getElementById('modalSaquePix');
  const btnAbrir = document.getElementById('btnAbrirModalSaque');
  const btnFechar = document.getElementById('btnFecharModalSaque');
  const btnCancelar = document.getElementById('btnCancelarSaqueModal');
  const btnConfirmar = document.getElementById('btnConfirmarSaquePix');
  const inputValor = document.getElementById('saqueValor');
  const inputChave = document.getElementById('saqueChavePix');
  const selectTipo = document.getElementById('saqueTipoChave');
  const modalSaldoTexto = document.getElementById('modalSaldoTexto');
  const btnSacarTudo = document.getElementById('btnSacarTudo');
  const btnExportar = document.getElementById('btnExportarFechamentoDia');

  if (btnExportar) btnExportar.onclick = (e) => { e.preventDefault(); exportarResumoDia(); };

  // Só os botões de valor do modal de saque (não os filtros da loja)
  modalSaque?.querySelectorAll('.btn-fast-val[data-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (inputValor) inputValor.value = Number(btn.getAttribute('data-val')).toFixed(2);
    });
  });

  btnSacarTudo?.addEventListener('click', () => {
    if (inputValor) inputValor.value = Math.max(0, Number(estado.saldoCarteira || 0)).toFixed(2);
  });

  function abrirModal() {
    if (!modalSaque) return;
    if (modalSaldoTexto) modalSaldoTexto.textContent = reais(estado.saldoCarteira);
    const chaveSalva = localStorage.getItem('huby_motorista_pix') || '';
    if (chaveSalva && inputChave && !inputChave.value) inputChave.value = chaveSalva;
    modalSaque.style.display = 'flex';
  }

  function fecharModal() {
    if (modalSaque) modalSaque.style.display = 'none';
  }

  btnAbrir?.addEventListener('click', abrirModal);
  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);

  modalSaque?.addEventListener('click', (e) => {
    if (e.target === modalSaque) fecharModal();
  });

  btnConfirmar?.addEventListener('click', async () => {
    if (sacandoAgora) return;

    const chave = String(inputChave?.value || '').trim();
    const tipo = selectTipo?.value || 'cpf';
    const valor = Math.round(parseFloat(String(inputValor?.value ?? '').replace(',', '.')) * 100) / 100;
    const saldo = Number(estado.saldoCarteira || 0);

    if (!chave) {
      notificar('Informe a chave Pix para recebimento.', 'alerta');
      return;
    }
    const erroChave = validarChavePix(tipo, chave);
    if (erroChave) {
      notificar(erroChave, 'alerta');
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      notificar('Informe um valor de saque válido.', 'alerta');
      return;
    }
    if (valor > saldo) {
      notificar(`Saldo insuficiente. Disponível: ${reais(saldo)}.`, 'erro');
      return;
    }

    const motId = estado.motoristaId;
    if (!motId) {
      notificar('Não foi possível identificar sua conta. Feche e abra o app de novo.', 'erro');
      return;
    }

    sacandoAgora = true;
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Enviando pedido...';

    try {
      const res = await fetch(`${API_URL}/api/carteira/motorista/${encodeURIComponent(motId)}/saque`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ valor, chave_pix: chave, tipo_chave: tipo })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Não foi possível processar o saque.');

      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      notificar(data.mensagem || 'Pedido de saque enviado!', 'sucesso', 5000);

      localStorage.setItem('huby_motorista_pix', chave);
      fecharModal();
      if (inputValor) inputValor.value = '';

      if (data.novoSaldo !== undefined && Number.isFinite(Number(data.novoSaldo))) {
        estado.saldoCarteira = Number(data.novoSaldo);
      }
      const saldoTxt = reais(estado.saldoCarteira);
      const elSaldo = document.getElementById('saldoCarteiraValor');
      const elDrawerSaldo = document.getElementById('drawerSaldoValor');
      if (elSaldo) elSaldo.textContent = saldoTxt;
      if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

      await carregarPerfil(); // confirma o saldo real com o servidor
    } catch (err) {
      notificar(err instanceof TypeError ? 'Sem conexão. O saque NÃO foi feito.' : err.message, 'erro', 6000);
    } finally {
      sacandoAgora = false;
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Saque';
    }
  });
}