// js/motorista/motorista-carteira.js
import { API_URL, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { carregarPerfil } from './motorista-perfil.js';
import { notificar } from '../util/alertas-huby.js';

export function exportarResumoDia() {
  const saldo = document.getElementById('saldoCarteiraValor')?.textContent || `R$ ${Number(estado.saldoCarteira || 0).toFixed(2).replace('.', ',')}`;
  const ganhosHoje = document.getElementById('lblGanhosHojeValor')?.textContent || 'R$ 0,00';
  const corridasHoje = document.getElementById('lblCorridasHojeQtd')?.textContent || '0 viagens';
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const pctLiquido = Math.max(1, 100 - Number(TAXA_PLATAFORMA_ATUAL ?? 15));

  const relatorio = `
=========================================
          HUBY • FECHAMENTO DO DIA
=========================================
Data: ${dataHoje}
Condutor: ${estado.motoristaNome || 'Carol'}
Viagens Realizadas Hoje: ${corridasHoje}
Repasse Líquido Ganho (${pctLiquido}%): ${ganhosHoje}
Saldo Disponível em Carteira: ${saldo}
=========================================
Emitido via Central do Motorista HUBy
`;

  const blob = new Blob([relatorio.trim()], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `HUBy_Fechamento_${dataHoje.replace(/\//g, '-')}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
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
  const btnExportarRelatorio = document.getElementById('btnExportarFechamentoDia') || document.getElementById('btnExportarResumoDia');

  btnExportarRelatorio?.addEventListener('click', exportarResumoDia);

  document.querySelectorAll('.btn-fast-val').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (val && inputValor) {
        inputValor.value = val;
      }
    });
  });

  btnSacarTudo?.addEventListener('click', () => {
    if (inputValor) {
      inputValor.value = Math.max(0, estado.saldoCarteira).toFixed(2);
    }
  });

  function abrirModal() {
    if (!modalSaque) return;
    if (modalSaldoTexto) {
      modalSaldoTexto.textContent = `R$ ${Number(estado.saldoCarteira || 0).toFixed(2).replace('.', ',')}`;
    }
    const chaveSalva = localStorage.getItem('huby_motorista_pix') || '';
    if (chaveSalva && inputChave && !inputChave.value) {
      inputChave.value = chaveSalva;
    }
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
    const chave = inputChave?.value?.trim();
    const valor = parseFloat(inputValor?.value);
    const tipo = selectTipo?.value || 'pix';

    if (!chave) {
      notificar('Por favor, informe a chave Pix para recebimento.', 'alerta');
      return;
    }

    if (!valor || valor <= 0) {
      notificar('Informe um valor de saque válido.', 'alerta');
      return;
    }

    if (valor > estado.saldoCarteira) {
      notificar(`Saldo insuficiente. Disponível: R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}.`, 'erro');
      return;
    }

    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Enviando...';

    try {
      const motId = estado.motoristaId || localStorage.getItem('huby_motorista_id') || 'carol_01';
      const res = await fetch(`${API_URL}/api/carteira/motorista/${motId}/saque`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ valor, chave_pix: chave, tipo_chave: tipo })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao processar saque.');

      notificar(data.mensagem || 'Solicitação de saque enviada com sucesso!', 'sucesso');
      localStorage.setItem('huby_motorista_pix', chave);
      fecharModal();
      if (inputValor) inputValor.value = '';

      if (data.novoSaldo !== undefined) {
        estado.saldoCarteira = Number(data.novoSaldo);
      } else {
        estado.saldoCarteira -= valor;
      }

      const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
      const elSaldo = document.getElementById('saldoCarteiraValor');
      const elDrawerSaldo = document.getElementById('drawerSaldoValor');
      if (elSaldo) elSaldo.textContent = saldoTxt;
      if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

      carregarPerfil();
    } catch (err) {
      notificar(err.message, 'erro');
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Saque';
    }
  });
}