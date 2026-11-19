// js/auth.js - Cadastro HUBy (Encaminha para a tela de login após confirmar)
import { API_URL } from './config.js';

let roleAtual = 'cliente';

document.addEventListener('DOMContentLoaded', () => {
  const btnRoleCliente = document.getElementById('btnRoleCliente');
  const btnRoleMotorista = document.getElementById('btnRoleMotorista');
  const roleSelector = document.getElementById('roleSelectorContainer');
  const secaoMotorista = document.getElementById('secaoMotoristaVeiculo');
  const secaoSegurancaPassageiro = document.getElementById('secaoSegurancaPassageiro');
  const grpDataNascPassageiro = document.getElementById('grpDataNascPassageiro');
  const txtSubtitulo = document.getElementById('txtSubtitulo');
  const btnSubmit = document.getElementById('btnSubmeterCadastro');
  const alertaBox = document.getElementById('alertaBox');
  const linkLoginDireto = document.getElementById('linkLoginDireto');

  function exibirAlerta(msg, tipo) {
    if (!alertaBox) return;
    alertaBox.textContent = msg;
    alertaBox.className = `auth-alert ${tipo}`;
    alertaBox.style.display = 'block';
  }

  function esconderAlerta() {
    if (!alertaBox) return;
    alertaBox.style.display = 'none';
  }

  function ativarCliente() {
    roleAtual = 'cliente';
    btnRoleCliente?.classList.add('active');
    btnRoleMotorista?.classList.remove('active');

    if (secaoSegurancaPassageiro) secaoSegurancaPassageiro.style.display = 'block';
    if (grpDataNascPassageiro) grpDataNascPassageiro.style.display = 'block';
    if (secaoMotorista) secaoMotorista.style.display = 'none';

    if (txtSubtitulo) txtSubtitulo.textContent = 'Crie a sua conta para solicitar viagens instantâneas';
    if (btnSubmit) btnSubmit.querySelector('span').textContent = 'Criar Conta de Passageiro';
    if (linkLoginDireto) linkLoginDireto.href = './login.html?perfil=cliente';
    localStorage.setItem('huby_tipo_acesso', 'cliente');
    esconderAlerta();
  }

  function ativarMotorista() {
    roleAtual = 'motorista';
    btnRoleMotorista?.classList.add('active');
    btnRoleCliente?.classList.remove('active');

    if (secaoSegurancaPassageiro) secaoSegurancaPassageiro.style.display = 'none';
    if (secaoMotorista) secaoMotorista.style.display = 'block';

    if (txtSubtitulo) txtSubtitulo.textContent = 'Cadastre seu veículo e comece a rodar com liberação automática';
    if (btnSubmit) btnSubmit.querySelector('span').textContent = 'Cadastrar Motorista Parceiro';
    if (linkLoginDireto) linkLoginDireto.href = './login.html?perfil=motorista';
    localStorage.setItem('huby_tipo_acesso', 'motorista');
    esconderAlerta();
  }

  btnRoleCliente?.addEventListener('click', ativarCliente);
  btnRoleMotorista?.addEventListener('click', ativarMotorista);

  const urlParams = new URLSearchParams(window.location.search);
  const perfilEscolhido = urlParams.get('perfil') || localStorage.getItem('huby_tipo_acesso') || 'cliente';

  if (perfilEscolhido === 'motorista') {
    ativarMotorista();
  } else {
    ativarCliente();
  }

  if (urlParams.get('perfil') && roleSelector) {
    roleSelector.style.display = 'none';
  }

  document.getElementById('cadCpf')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    e.target.value = v;
  });

  document.getElementById('cadTelefone')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
    e.target.value = v;
  });

  document.getElementById('cadEmergenciaTelefone')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
    e.target.value = v;
  });

  document.getElementById('cadPlaca')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const btnToggle = document.getElementById('btnToggleSenha');
  const inSenha = document.getElementById('cadSenha');
  btnToggle?.addEventListener('click', () => {
    const isPass = inSenha.type === 'password';
    inSenha.type = isPass ? 'text' : 'password';
    btnToggle.textContent = isPass ? '🔒' : '👁️';
  });

  const converterParaBase64 = (arquivo) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(arquivo);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
    });
  };

  document.getElementById('formCadastroHuby')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    esconderAlerta();

    const nome = document.getElementById('cadNome')?.value.trim();
    const cpf = document.getElementById('cadCpf')?.value.trim();
    const telefone = document.getElementById('cadTelefone')?.value.trim();
    const email = document.getElementById('cadEmail')?.value.trim();
    const senha = document.getElementById('cadSenha')?.value.trim();

    if (!nome || !cpf || !telefone || !email || !senha) {
      exibirAlerta('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    if (senha.length < 6) {
      exibirAlerta('A senha deve conter pelo menos 6 caracteres.', 'error');
      return;
    }

    const inDataCliente = document.getElementById('cadDataNascCliente')?.value;
    const inDataMotorista = document.getElementById('cadDataNascMotorista')?.value;
    const inDataPadrao = document.getElementById('cadDataNascimento')?.value;

    let dataNascimentoVal = inDataCliente || inDataMotorista || inDataPadrao || '';
    if (dataNascimentoVal) {
      const partes = dataNascimentoVal.split('-');
      if (partes[0] && partes[0].length > 4) {
        partes[0] = partes[0].substring(0, 4);
        dataNascimentoVal = partes.join('-');
      }
    }

    if (!dataNascimentoVal) {
      exibirAlerta('Informe a sua data de nascimento.', 'error');
      return;
    }

    const payload = {
      nome,
      cpf,
      telefone,
      email,
      senha,
      dataNascimento: dataNascimentoVal,
      role: roleAtual,
      aprovacaoAutomatica: true,
      status_aprovacao: 'aprovado'
    };

    if (roleAtual === 'cliente') {
      const emergenciaNome = document.getElementById('cadEmergenciaNome')?.value.trim();
      const emergenciaTel = document.getElementById('cadEmergenciaTelefone')?.value.trim();

      if (!emergenciaNome || !emergenciaTel) {
        exibirAlerta('Indique o nome e o telefone do seu contato de emergência.', 'error');
        return;
      }

      payload.contatoEmergenciaNome = emergenciaNome;
      payload.contatoEmergenciaTelefone = emergenciaTel;
    }

    if (roleAtual === 'motorista') {
      const cnh = document.getElementById('cadCnh')?.value.trim();
      const modelo = document.getElementById('cadModelo')?.value.trim();
      const placa = document.getElementById('cadPlaca')?.value.trim().toUpperCase();
      const categoria = document.getElementById('cadCategoriaVeiculo')?.value || 'carro';
      const cor = document.getElementById('cadCorVeiculo')?.value?.trim() || 'Prata';
      const ano = document.getElementById('cadAnoVeiculo')?.value?.trim() || '2023';
      const chavePix = document.getElementById('cadChavePix')?.value?.trim() || '';
      const fileInput = document.getElementById('cadFotoVeiculo');

      if (!cnh || cnh.replace(/\D/g, '').length !== 11) {
        exibirAlerta('Informe um número de CNH válido com 11 dígitos.', 'error');
        return;
      }

      if (!modelo || !placa) {
        exibirAlerta('Preencha o modelo e a placa do veículo.', 'error');
        return;
      }

      payload.cnh = cnh;
      payload.cnh_numero = cnh;
      payload.veiculo_modelo = modelo;
      payload.veiculo_placa = placa;
      payload.veiculo_cor = cor;
      payload.veiculo_ano = ano;
      payload.categoria = categoria;
      payload.categoria_veiculo = categoria;
      payload.status_aprovacao = 'aprovado';
      if (chavePix) payload.chave_pix_padrao = chavePix;

      if (fileInput?.files && fileInput.files[0]) {
        try {
          payload.fotoVeiculo = await converterParaBase64(fileInput.files[0]);
        } catch (errFoto) {
          console.warn('Erro na conversão da foto do veículo:', errFoto);
        }
      }
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.querySelector('span').textContent = 'Concluindo cadastro...';

      const resp = await fetch(`${API_URL}/api/usuarios/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = resp.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Servidor a inicializar. Aguarde alguns segundos e tente novamente.');
      }

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.erro || 'Falha ao concluir registo.');
      }

      const perfilFinal = data.usuario?.role || roleAtual;
      localStorage.setItem('huby_tipo_acesso', perfilFinal);
      if (email) {
        localStorage.setItem('huby_ultimo_email_cadastro', email.toLowerCase());
      }
      if (payload.chave_pix_padrao) {
        localStorage.setItem('huby_motorista_pix', payload.chave_pix_padrao);
      }

      exibirAlerta(
        perfilFinal === 'motorista'
          ? 'Cadastro de motorista aprovado automaticamente! A encaminhar para o login do motorista...'
          : 'Conta criada com sucesso! A encaminhar para o login...',
        'success'
      );

      setTimeout(() => {
        window.location.replace(`./login.html?perfil=${encodeURIComponent(perfilFinal)}&cadastrado=1`);
      }, 900);
    } catch (err) {
      exibirAlerta(err.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.querySelector('span').textContent = roleAtual === 'cliente'
        ? 'Criar Conta de Passageiro'
        : 'Cadastrar Motorista Parceiro';
    }
  });
});