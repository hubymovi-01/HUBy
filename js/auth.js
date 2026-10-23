import { API_URL } from './config.js';

let roleAtual = 'cliente';

document.addEventListener('DOMContentLoaded', () => {
  const btnRoleCliente = document.getElementById('btnRoleCliente');
  const btnRoleMotorista = document.getElementById('btnRoleMotorista');
  const secaoMotorista = document.getElementById('secaoMotoristaVeiculo');
  const txtSubtitulo = document.getElementById('txtSubtitulo');
  const btnSubmit = document.getElementById('btnSubmeterCadastro');
  const alertaBox = document.getElementById('alertaBox');

  // Alternador de Perfis
  btnRoleCliente?.addEventListener('click', () => {
    roleAtual = 'cliente';
    btnRoleCliente.classList.add('active');
    btnRoleMotorista.classList.remove('active');
    secaoMotorista.style.display = 'none';
    txtSubtitulo.textContent = 'Crie a sua conta para solicitar viagens instantâneas';
    btnSubmit.querySelector('span').textContent = 'Criar Conta de Passageiro';
    esconderAlerta();
  });

  btnRoleMotorista?.addEventListener('click', () => {
    roleAtual = 'motorista';
    btnRoleMotorista.classList.add('active');
    btnRoleCliente.classList.remove('active');
    secaoMotorista.style.display = 'block';
    txtSubtitulo.textContent = 'Cadastre seu veículo e receba 85% líquido por corrida';
    btnSubmit.querySelector('span').textContent = 'Cadastrar Motorista Parceiro';
    esconderAlerta();
  });

  // Máscara de CPF
  document.getElementById('cadCpf')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    e.target.value = v;
  });

  // Máscara de Telefone
  document.getElementById('cadTelefone')?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
    e.target.value = v;
  });

  // Formatação de Placa
  document.getElementById('cadPlaca')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Botão Mostrar/Ocultar Senha
  const btnToggle = document.getElementById('btnToggleSenha');
  const inSenha = document.getElementById('cadSenha');
  btnToggle?.addEventListener('click', () => {
    const isPass = inSenha.type === 'password';
    inSenha.type = isPass ? 'text' : 'password';
    btnToggle.textContent = isPass ? '🔒' : '👁️';
  });

  // Utilitário para converter foto em Base64
  const converterParaBase64 = (arquivo) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(arquivo);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
    });
  };

  // Submissão do Formulário
  document.getElementById('formCadastroHuby')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    esconderAlerta();

    const nome = document.getElementById('cadNome').value.trim();
    const cpf = document.getElementById('cadCpf').value.trim();
    const telefone = document.getElementById('cadTelefone').value.trim();
    const email = document.getElementById('cadEmail').value.trim();
    const senha = document.getElementById('cadSenha').value.trim();

    if (!nome || !cpf || !telefone || !email || !senha) {
      exibirAlerta('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    if (senha.length < 6) {
      exibirAlerta('A palavra-passe deve conter pelo menos 6 carateres.', 'error');
      return;
    }

    const payload = {
      nome,
      cpf,
      telefone,
      email,
      senha,
      role: roleAtual
    };

    if (roleAtual === 'motorista') {
      const cnh = document.getElementById('cadCnh').value.trim();
      const dataNasc = document.getElementById('cadDataNasc').value;
      const modelo = document.getElementById('cadModelo').value.trim();
      const placa = document.getElementById('cadPlaca').value.trim().toUpperCase();
      const categoria = document.getElementById('cadCategoriaVeiculo').value;
      const fileInput = document.getElementById('cadFotoVeiculo');

      if (!cnh || cnh.replace(/\D/g, '').length !== 11) {
        exibirAlerta('Informe um número de CNH válido com 11 dígitos.', 'error');
        return;
      }

      if (!dataNasc) {
        exibirAlerta('Informe a sua data de nascimento para validação de idade.', 'error');
        return;
      }

      if (!modelo || !placa) {
        exibirAlerta('Preencha o modelo e a placa do veículo.', 'error');
        return;
      }

      payload.cnh = cnh;
      payload.dataNascimento = dataNasc;
      payload.veiculo_modelo = modelo;
      payload.veiculo_placa = placa;
      payload.categoria_veiculo = categoria;

      if (fileInput.files && fileInput.files[0]) {
        try {
          payload.fotoVeiculo = await converterParaBase64(fileInput.files[0]);
        } catch (errFoto) {
          console.warn('Erro ao carregar foto do veículo:', errFoto);
        }
      }
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.querySelector('span').textContent = 'Validando e registando...';

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