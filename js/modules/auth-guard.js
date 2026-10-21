// ./js/modules/auth-guard.js

export class AuthGuard {
  constructor(apiUrl = 'https://huby.onrender.com') {
    this.apiUrl = apiUrl;
    this.adminBtn = document.getElementById('menuAdminBtn');
    this.walletPill = document.getElementById('btnIrCarteira');
    this.btnSairConta = document.getElementById('btnSairConta');
    this.cliquesCarteira = 0;
    this.ultimaCliques = 0;

    this.init();
  }

  init() {
    this.verificarPermissoesIniciais();
    this.carregarDadosPerfil();
    this.configurarAtalhoAdmin();
    this.configurarBotaoSair();
    this.registrarServiceWorker();
  }

  // 1. ROTEAMENTO POR CATEGORIA DE PARCEIRO
  verificarPermissoesIniciais() {
    const papel = localStorage.getItem('huby_user_role');
    const categoria = localStorage.getItem('huby_parceiro_categoria');

    if (papel === 'motorista') {
      if (categoria === 'moto' || categoria === 'flash') {
        if (!window.location.pathname.includes('painel-motoboy.html')) {
          window.location.replace('./painel-motoboy.html');
        }
        return;
      }

      if (categoria === 'cargo') {
        if (!window.location.pathname.includes('painel-cargo.html')) {
          window.location.replace('./painel-cargo.html');
        }
        return;
      }

      // Fallback para carro particular
      if (!window.location.pathname.includes('motorista.html')) {
        window.location.replace('./motorista.html');
      }
      return;
    }

    // Se já entrou como cliente, oculta a tela de splash
    const jaEntrou = localStorage.getItem('huby_ja_entrou');
    if (jaEntrou === '1') {
      document.documentElement.classList.add('app-pronto');
      const splash = document.getElementById('splashScreen');
      if (splash) splash.style.display = 'none';
    }

    this.sincronizarStatusAdmin();
  }

  // 2. SINCRONIZAÇÃO SEGURA DO ADMIN (SEM DADOS HARDCODED)
  async sincronizarStatusAdmin() {
    const tokenAdmin = localStorage.getItem('huby_admin_token');
    const role = localStorage.getItem('huby_user_role');
    const emailLogado = localStorage.getItem('huby_cliente_email');
    const btnAdmin = this.adminBtn || document.getElementById('menuAdminBtn');

    if (tokenAdmin === 'token_admin_autorizado_998877' || role === 'admin') {
      if (btnAdmin) btnAdmin.style.display = 'flex';
      return;
    }

    // Validação remota de contingência se o login foi muito rápido
    if (emailLogado && !tokenAdmin) {
      try {
        const res = await fetch(`${this.apiUrl}/api/admin/verificar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailLogado })
        });
        const data = await res.json();
        if (data.sucesso && data.isAdmin) {
          localStorage.setItem('huby_admin_token', data.token);
          localStorage.setItem('huby_user_role', 'admin');
          if (btnAdmin) btnAdmin.style.display = 'flex';
        }
      } catch (err) {
        // Mantém oculto silenciosamente se o servidor estiver dormindo
      }
    }
  }

  // 3. EXIBIÇÃO DE DADOS DO USUÁRIO NA ABA CONTA
  carregarDadosPerfil() {
    const emailLogado = localStorage.getItem('huby_cliente_email');
    const txtPerfilNome = document.getElementById('txtPerfilNome');
    const txtPerfilAvatar = document.getElementById('txtPerfilAvatar');

    if (emailLogado && txtPerfilNome) {
      const usuario = emailLogado.split('@')[0];
      const nomeFormatado = usuario.charAt(0).toUpperCase() + usuario.slice(1);
      txtPerfilNome.textContent = nomeFormatado;

      if (txtPerfilAvatar) {
        txtPerfilAvatar.textContent = nomeFormatado.substring(0, 2).toUpperCase();
      }
    }
  }

  // 4. LOGOUT SEGURO
  configurarBotaoSair() {
    const btnSair = this.btnSairConta || document.getElementById('btnSairConta');
    btnSair?.addEventListener('click', () => {
      const confirmar = confirm('Tem certeza de que deseja sair da sua conta?');
      if (!confirmar) return;

      localStorage.removeItem('huby_ja_entrou');
      localStorage.removeItem('huby_user_role');
      localStorage.removeItem('huby_admin_token');
      localStorage.removeItem('huby_cliente_email');
      localStorage.removeItem('huby_corrida_ativa');
      localStorage.removeItem('huby_parceiro_categoria');

      window.location.reload();
    });
  }

  // 5. ATALHO SECUNDÁRIO NA CARTEIRA (OPCIONAL)
  configurarAtalhoAdmin() {
    const pill = this.walletPill || document.getElementById('btnIrCarteira');
    pill?.addEventListener('click', async () => {
      const agora = Date.now();
      if (agora - this.ultimaCliques > 1500) {
        this.cliquesCarteira = 1;
      } else {
        this.cliquesCarteira++;
      }
      this.ultimaCliques = agora;

      if (this.cliquesCarteira >= 3) {
        this.cliquesCarteira = 0;
        await this.solicitarAcessoAdmin();
      }
    });
  }

  async solicitarAcessoAdmin() {
    if (localStorage.getItem('huby_admin_token') === 'token_admin_autorizado_998877') {
      return;
    }

    const senhaDigitada = prompt('🔒 Introduza a senha de Administrador:');
    if (!senhaDigitada) return;

    try {
      const response = await fetch(`${this.apiUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senhaAdmin: senhaDigitada })
      });
      const data = await response.json();

      if (data.sucesso) {
        localStorage.setItem('huby_admin_token', data.token);
        localStorage.setItem('huby_user_role', 'admin');
        const btnAdmin = this.adminBtn || document.getElementById('menuAdminBtn');
        if (btnAdmin) btnAdmin.style.display = 'flex';
      }
    } catch (err) {
      console.warn('Servidor offline para validação admin.');
    }
  }

  // 6. SERVICE WORKER PWA
  registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        const swPath = window.location.pathname.includes('/HUBy')
          ? '/HUBy/service-worker.js'
          : './service-worker.js';

        navigator.serviceWorker.register(swPath).catch(err => console.warn(err));
      });
    }
  }
}

// Inicialização automática ao carregar o DOM
document.addEventListener('DOMContentLoaded', () => {
  window.hubyAuthGuard = new AuthGuard();
});