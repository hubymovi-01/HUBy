// js/motorista/motorista-perfil.js - Perfil do Motorista e Configuração do Copiloto
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { 
  obterCodigoAtivacaoMotorista, 
  definirCodigoAtivacaoMotorista, 
  falarTexto 
} from '../ia/motorista-ia.js';

// ============================================================================
// 1. CARREGAR PERFIL DO BANCO E PREENCHER NA TELA
// ============================================================================
export async function carregarPerfil() {
  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil`, {
      headers: obterHeaders()
    });

    if (!resp.ok) return null;
    const motorista = await resp.json();

    if (!motorista) return null;

    estado.motoristaId = motorista.id;
    estado.categoriaMotorista = motorista.categoria || 'carro';
    estado.statusAprovacaoAtual = motorista.status_aprovacao || 'aprovado';

    if (motorista.codigo_voz && motorista.codigo_voz.trim()) {
      localStorage.setItem('huby_codigo_voz_motorista', motorista.codigo_voz.trim());
      const inputComando = document.getElementById('inputCodigoVozCopiloto');
      if (inputComando) inputComando.value = motorista.codigo_voz.trim();
    }

    const elNome = document.getElementById('txtNomeMotorista');
    const elVeiculo = document.getElementById('txtVeiculoMotorista');
    const elPlaca = document.getElementById('txtPlacaMotorista');
    const elSaldo = document.getElementById('txtSaldoCarteira');
    const elFoto = document.getElementById('imgFotoPerfilMotorista');

    if (elNome) elNome.textContent = motorista.nome || 'Motorista Parceiro';
    if (elVeiculo) elVeiculo.textContent = `${motorista.veiculo_modelo || 'Veículo'} • ${motorista.veiculo_cor || ''}`;
    if (elPlaca) elPlaca.textContent = motorista.veiculo_placa || 'Sem placa';
    if (elSaldo) elSaldo.textContent = `R$ ${Number(motorista.saldo_carteira || 0).toFixed(2).replace('.', ',')}`;

    if (elFoto && motorista.foto_perfil_url) {
      elFoto.src = motorista.foto_perfil_url;
    }

    const checkDinheiro = document.getElementById('chkAceitaDinheiro');
    const checkCartao = document.getElementById('chkAceitaCartao');
    const checkPix = document.getElementById('chkAceitaPix');

    if (checkDinheiro) checkDinheiro.checked = motorista.aceita_dinheiro !== false;
    if (checkCartao) checkCartao.checked = motorista.aceita_cartao !== false;
    if (checkPix) checkPix.checked = motorista.aceita_pix !== false;

    // Preenche os campos do formulário de edição se estiverem abertos
    const inNome = document.getElementById('inputPerfilNome');
    const inTel = document.getElementById('inputPerfilTelefone');
    const inMod = document.getElementById('inputPerfilModelo');
    const inPlaca = document.getElementById('inputPerfilPlaca');
    const inCor = document.getElementById('inputPerfilCor');

    if (inNome) inNome.value = motorista.nome || '';
    if (inTel) inTel.value = motorista.telefone || '';
    if (inMod) inMod.value = motorista.veiculo_modelo || '';
    if (inPlaca) inPlaca.value = motorista.veiculo_placa || '';
    if (inCor) inCor.value = motorista.veiculo_cor || '';

    return motorista;
  } catch (err) {
    console.warn('Erro ao carregar dados do perfil:', err);
    return null;
  }
}

// ============================================================================
// 2. CONFIGURAÇÃO DO COMANDO DE VOZ (COPILOTO HANDS-FREE)
// ============================================================================
export function configurarCodigoVozCopiloto() {
  const inputComando = document.getElementById('inputCodigoVozCopiloto');
  const btnSalvar = document.getElementById('btnSalvarCodigoVoz');
  const btnTestar = document.getElementById('btnTestarCodigoVoz');

  if (inputComando) {
    inputComando.value = obterCodigoAtivacaoMotorista();
  }

  btnSalvar?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const novoComando = inputComando?.value?.trim();
    if (!novoComando) {
      notificar('Digite uma frase para ativar seu copiloto (ex: OK Gavião, Ei Jarvis).', 'alerta');
      inputComando?.focus();
      return;
    }

    const sucesso = await definirCodigoAtivacaoMotorista(novoComando);
    if (sucesso) {
      notificar(`Comando atualizado! Diga "${novoComando}" para falar com o app.`, 'sucesso');
    } else {
      notificar('Erro ao registrar comando. Tente novamente.', 'erro');
    }
  });

  btnTestar?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const comandoAtual = inputComando?.value?.trim() || obterCodigoAtivacaoMotorista();
    falarTexto(`Copiloto pronto. Pode falar ${comandoAtual} seguido da ação que deseja.`);
  });
}

// ============================================================================
// 3. SALVAR PREFERÊNCIAS DE FORMAS DE PAGAMENTO
// ============================================================================
export function configurarSalvarPreferenciasPagto() {
  const btnSalvar = document.getElementById('btnSalvarPreferenciasPagto');
  if (!btnSalvar) return;

  btnSalvar.addEventListener('click', async (e) => {
    e.preventDefault();
    const aceita_dinheiro = document.getElementById('chkAceitaDinheiro')?.checked ?? true;
    const aceita_cartao = document.getElementById('chkAceitaCartao')?.checked ?? true;
    const aceita_pix = document.getElementById('chkAceitaPix')?.checked ?? true;

    if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
      notificar('Selecione ao menos uma forma de recebimento.', 'alerta');
      return;
    }

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/motoristas/preferencias-pagamento`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ aceita_dinheiro, aceita_cartao, aceita_pix })
      });

      if (resp.ok) {
        notificar('Preferências de pagamento salvas!', 'sucesso');
      } else {
        notificar('Erro ao salvar preferências.', 'erro');
      }
    } catch (err) {
      notificar('Falha de conexão ao salvar preferências.', 'erro');
    }
  });
}

// ============================================================================
// 4. EDIÇÃO DE DADOS BÁSICOS DO MOTORISTA E CONTROLE DO MODAL
// ============================================================================
export function configurarEdicaoPerfil() {
  const btnAbrirModal = document.getElementById('btnAbrirModalEditarPerfil');
  const modalEditar = document.getElementById('modalEditarPerfilMotorista');
  const btnFecharModal = document.getElementById('btnFecharModalEditarPerfil');
  const btnSalvar = document.getElementById('btnSalvarDadosPerfil');

  // Abre o modal de edição
  btnAbrirModal?.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalEditar) {
      modalEditar.style.display = 'flex';
      carregarPerfil(); // Recarrega os dados nos inputs
    }
  });

  // Fecha o modal
  btnFecharModal?.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalEditar) modalEditar.style.display = 'none';
  });

  if (!btnSalvar) return;

  btnSalvar.addEventListener('click', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('inputPerfilNome')?.value?.trim();
    const telefone = document.getElementById('inputPerfilTelefone')?.value?.trim();
    const veiculo_modelo = document.getElementById('inputPerfilModelo')?.value?.trim();
    const veiculo_placa = document.getElementById('inputPerfilPlaca')?.value?.trim();
    const veiculo_cor = document.getElementById('inputPerfilCor')?.value?.trim();

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({
          nome,
          telefone,
          veiculo_modelo,
          veiculo_placa,
          veiculo_cor
        })
      });

      if (resp.ok) {
        notificar('Perfil atualizado com sucesso!', 'sucesso');
        if (modalEditar) modalEditar.style.display = 'none';
        await carregarPerfil();
      } else {
        notificar('Não foi possível salvar os dados.', 'erro');
      }
    } catch (e) {
      notificar('Erro de conexão ao salvar perfil.', 'erro');
    }
  });
}