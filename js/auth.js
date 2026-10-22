/**
 * ============================================================================
 * HUBy 2.0 - Controlo Unificado de Autenticação (js/auth.js)
 * ============================================================================
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  // 1. ALTERNÂNCIA DE ABAS NO LOGIN (PASSAGEIRO VS MOTORISTA)
  const tabCliente = document.getElementById('tabCliente');
  const tabMotorista = document.getElementById('tabMotorista');
  const formLoginCliente = document.getElementById('formLoginCliente');
  const formLoginMotorista = document.getElementById('formLoginMotorista');

  if (tabCliente && tabMotorista) {
    tabCliente.addEventListener('click', () => {
      tabCliente.classList.add('active');
      tabMotorista.classList.remove('active');
      formLoginCliente.style.display = 'flex';
      formLoginMotorista.style.display = 'none';
    });

    tabMotorista.addEventListener('click', () => {
      tabMotorista.classList.add('active');
      tabCliente.classList.remove('active');
      formLoginMotorista.style.display = 'flex';
      formLoginCliente.style.display = 'none';
    });
  }

  // 2. SUBMISSÃO DE LOGIN (PASSAGEIRO / ADMIN)
  formLoginCliente?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnEntrarCliente');
    const email = document.getElementById('emailCliente').value.trim();
    const senha = document.getElementById('senhaCliente').value;

    try {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'A validar...';

      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });

      const dados = await resp.json();

      if (!resp.ok) {
        throw new Error(dados.erro || 'Falha ao iniciar sessão.');
      }

      // Armazenamento de sessão seguro
      localStorage.setItem('huby_token', dados.token);
      localStorage.setItem('huby_user_role', dados.usuario.role);
      localStorage.setItem('huby_user_id', dados.usuario.id);
      localStorage.setItem('huby_user_nome', dados.usuario.nome);
      localStorage.setItem('huby_user_email', dados.usuario.email);

      // Redirecionamento condicional de perfil
      if (dados.usuario.role === 'admin') {
        window.location.replace('./admin.html');
      } else {
        window.location.replace('./index.html');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Entrar';
    }
  });

  // 3. SUBMISSÃO DE LOGIN (MOTORISTA)
  formLoginMotorista?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnEntrarMotorista');
    const cnh = document.getElementById('cnhMotorista').value.trim();
    const placa = document.getElementById('placaMotorista').value.trim();

    try {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'A verificar registo...';

      const resp = await fetch(`${API_BASE}/api/motoristas/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnh, placa })
      });

      const dados = await resp.json();

      if (!resp.ok) {
        throw new Error(dados.erro || 'Credenciais de parceiro não localizadas.');
      }

      localStorage.setItem('huby_token', dados.token);
      localStorage.setItem('huby_user_role', 'motorista');
      localStorage.setItem('huby_motorista_id', dados.motorista.id);
      localStorage.setItem('huby_motorista_nome', dados.motorista.nome);
      localStorage.setItem('huby_motorista_categoria', dados.motorista.categoria);

      window.location.replace('./motorista.html');
    } catch (err) {
      alert(err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Aceder ao Radar de Parceiro';
    }
  });

  // 4. SUBMISSÃO DE REGISTO DE NOVO PASSAGEIRO
  const formCadastroCliente = document.getElementById('formCadastroCliente');
  formCadastroCliente?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnSubmeterCadastro');
    const nome = document.getElementById('cadNome').value.trim();
    const email = document.getElementById('cadEmail').value.trim();
    const telefone = document.getElementById('cadTelefone').value.trim();
    const cpf = document.getElementById('cadCpf').value.trim();
    const senha = document.getElementById('cadSenha').value;

    try {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'A criar conta...';

      const resp = await fetch(`${API_BASE}/api/auth/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, telefone, cpf, senha })
      });

      const dados = await resp.json();

      if (!resp.ok) {
        throw new Error(dados.erro || 'Falha ao criar o registo.');
      }

      localStorage.setItem('huby_token', dados.token);
      localStorage.setItem('huby_user_role', dados.usuario.role);
      localStorage.setItem('huby_user_id', dados.usuario.id);
      localStorage.setItem('huby_user_nome', dados.usuario.nome);
      localStorage.setItem('huby_user_email', dados.usuario.email);

      alert('Conta criada com sucesso!');
      window.location.replace('./index.html');
    } catch (err) {
      alert(err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Criar Conta';
    }
  });
});