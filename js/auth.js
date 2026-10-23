import { API_URL } from './config.js';

let roleAtual = 'cliente'; // 'cliente' ou 'motorista'

document.addEventListener('DOMContentLoaded', () => {
  const btnRoleCliente = document.getElementById('btnRoleCliente');
  const btnRoleMotorista = document.getElementById('btnRoleMotorista');
  const secaoMotorista = document.getElementById('secaoMotoristaVeiculo');
  const txtSubtitulo = document.getElementById('txtSubtitulo');
  const btnSubmit = document.getElementById('btnSubmeterCadastro');
  const alertaBox = document.getElementById('alertaBox');

  // 1. ALTERNADOR DE PERFIL
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
    txtSubtitulo.textContent = 'Trabalhe connosco e receba 85% líquido por corrida';
    btnSubmit.querySelector('span').textContent = 'Cadastrar Motorista Parceiro';
    esconderAlerta();
  });

  // 2. MÁSCARA AUTOMÁTICA DE CPF (000.000.000-00)
  const inputCpf = document.getElementById('cadCpf');
  inputCpf?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    e.target.value = v;
  });

  // 3. MÁSCARA AUTOMÁTICA DE TELEFONE ((00) 00000-0000)
  const inputTel = document.getElementById('cadTelefone');
  inputTel?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
    e.target.value = v;
  });

  // 4. MÁSCARA / VALIDAÇÃO DE PLACA (MERCOSUL / TRADICIONAL)
  const inputPlaca = document.getElementById('cadPlaca');
  inputPlaca?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // 5. MOSTRAR / OCULTAR PALAVRA-PASSE
  const btnToggleSenha = document.getElementById('btnToggleSenha');
  const inputSenha = document.getElementById('cadSenha');
  btnToggleSenha?.addEventListener('click', () => {
    const isPass = inputSenha.type === 'password';
    inputSenha.type = isPass ? 'text' : 'password';
    btnToggleSenha.textContent = isPass ? '🔒' : '👁️';
  });

  // 6. ENVIO DO FORMULÁRIO COM VALIDAÇÃO
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
      payload.cnh = document.getElementById('cadCnh').value.trim();
      payload.categoria_veiculo = document.getElementById('cadCategoriaVeiculo').value;
      payload.veiculo_modelo = document.getElementById('cadModelo').value.trim();
      payload.veiculo_placa = document.getElementById('cadPlaca').value.trim().toUpperCase();

      if (!payload.cnh || !payload.veiculo_placa || !payload.veiculo_modelo) {
        exibirAlerta('Para condutores parceiros, indique a CNH, Modelo e Placa.', 'error');
        return;
      }
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.querySelector('span').textContent = 'Processando registo...';

      const resp = await fetch(`${API_URL}/api/usuarios/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Valida se o backend devolveu HTML em vez de JSON (servidor dormindo/offline)
      const contentType = resp.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Servidor indisponível ou a iniciar. Aguarde 20 segundos e tente de novo.');
      }

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.erro || 'Falha ao concluir registo.');
      }

      // Salva sessão
      localStorage.setItem('huby_token', data.token);
      localStorage.setItem('huby_user_id', data.usuario.id);
      localStorage.setItem('huby_user_name', data.usuario.nome);
      localStorage.setItem('huby_user_role', data.usuario.role);

      exibirAlerta('Registo concluído! A entrar...', 'success');

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