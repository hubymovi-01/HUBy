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

  function ativarCliente() {
    roleAtual = 'cliente';
    btnRoleCliente?.classList.add('active');
    btnRoleMotorista?.classList.remove('active');

    if (secaoSegurancaPassageiro) secaoSegurancaPassageiro.style.display = 'block';
    if (grpDataNascPassageiro) grpDataNascPassageiro.style.display = 'block';
    if (secaoMotorista) secaoMotorista.style.display = 'none';

    txtSubtitulo.textContent = 'Crie a sua conta para solicitar viagens instantâneas';
    btnSubmit.querySelector('span').textContent = 'Criar Conta de Passageiro';
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

    txtSubtitulo.textContent = 'Cadastre seu veículo, defina seus horários e dirija com liberdade';
    btnSubmit.querySelector('span').textContent = 'Cadastrar Motorista Parceiro';
    if (linkLoginDireto) linkLoginDireto.href = './login.html?perfil=motorista';
    localStorage.setItem('huby_tipo_acesso', 'motorista');
    esconderAlerta();
  }

  btnRoleCliente?.addEventListener('click', ativarCliente);
  btnRoleMotorista?.addEventListener('click', ativarMotorista);

  // Leitura do perfil vindo da URL
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

  // Máscaras de CPF, Telefone e Emergência
  document.getElementById('cadCpf')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    e.target.value = v;
  });

  document.getElementById('cadTelefone')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
    e.target.value = v;
  });

  document.getElementById('cadEmergenciaTelefone')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
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
      exibirAlerta('A palavra-passe deve conter pelo menos 6 carateres.', 'error');
      return;
    }

    // CAPTURA RESILIENTE DE DATA: Busca qualquer campo de data preenchido
    const inDataCliente = document.getElementById('cadDataNascCliente')?.value;
    const inDataMotorista = document.getElementById('cadDataNascMotorista')?.value;
    const inDataPadrao = document.getElementById('cadDataNascimento')?.value;

    let dataNascimentoVal = inDataCliente || inDataMotorista || inDataPadrao || '';

    // Corrige anos acidentais de 5 dígitos (ex: 20055 -> 2005)
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
      role: roleAtual
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
      const categoria = document.getElementById('cadCategoriaVeiculo')?.value;
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
      payload.veiculo_modelo = modelo;
      payload.veiculo_placa = placa;
      payload.categoria_veiculo = categoria;

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
      btnSubmit.querySelector('span').textContent = 'Validando dados e registrando...';

      const resp = await fetch(`${API_URL}/api/usuarios/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = resp.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Servidor a inicializar no Render. Aguarde 20 segundos e tente novamente.');
      }

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.erro || 'Falha ao concluir registo.');
      }

      localStorage.setItem('huby_token', data.token);
      localStorage.setItem('huby_user_id', data.usuario.id);
      localStorage.setItem('huby_user_name', data.usuario.nome);
      localStorage.setItem('huby_user_role', data.usuario.role);
      if (data.usuario.telefone) {
        localStorage.setItem('huby_user_phone', data.usuario.telefone);
      }
      if (payload.contatoEmergenciaNome) {
        localStorage.setItem('huby_emergencia_nome', payload.contatoEmergenciaNome);
        localStorage.setItem('huby_emergencia_tel', payload.contatoEmergenciaTelefone);
      }

      exibirAlerta('Conta criada com sucesso! Redirecionando...', 'success');

      setTimeout(() => {
        if (data.usuario.role === 'motorista') {
          window.location.replace('./motorista.html');
        } else {
          window.location.replace('./index.html');
        }
      }, 1000);

    } catch (err) {
      exibirAlerta(err.message, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.querySelector('span').textContent = roleAtual === 'cliente'
        ? 'Criar Conta de Passageiro'
        : 'Cadastrar Motorista Parceiro';
    }
  });

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
});