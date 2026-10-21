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

  verificarPermissoesIniciais() {
    const papel = localStorage.getItem('huby_user_role');
    if (papel === 'motorista') {
      window.location.replace('./motorista.html');
      return;
    }

    const tokenAdmin = localStorage.getItem('huby_admin_token');
    if (tokenAdmin === 'token_admin_autorizado_998877' && this.adminBtn) {
      this.adminBtn.style.display = 'flex';
    }
  }

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

  configurarBotaoSair() {
    const btnSair = this.btnSairConta || document.getElementById('btnSairConta');
    btnSair?.addEventListener('click', () => {
      const confirmar = confirm('Tem certeza de que deseja sair da sua conta?');
      if (!confirmar) return;

      // Limpa chaves de autenticação e sessão local
      localStorage.removeItem('huby_ja_entrou');
      localStorage.removeItem('huby_user_role');
      localStorage.removeItem('huby_admin_token');
      localStorage.removeItem('huby_cliente_email');
      localStorage.removeItem('huby_corrida_ativa');

      // Recarrega a página para exibir a tela de boas-vindas/login
      window.location.reload();
    });
  }

  configurarAtalhoAdmin() {
    this.walletPill?.addEventListener('click', async () => {
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
        if (this.adminBtn) this.adminBtn.style.display = 'flex';
      }
    } catch (err) {
      console.warn('Servidor offline para validação admin.');
    }
  }

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