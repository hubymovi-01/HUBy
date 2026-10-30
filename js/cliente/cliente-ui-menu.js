// js/cliente/cliente-ui-menu.js
import { API_URL } from '../config.js';
import { estadoCliente } from './cliente-estado.js';

export async function carregarSaldoCarteiraCliente() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_URL}/api/carteira/saldo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const dados = await res.json();
      estadoCliente.saldoCarteiraCliente = Number(dados.saldo || 0);
      const lblSaldo = document.getElementById('lblSaldoCarteira');
      if (lblSaldo) {
        lblSaldo.textContent = `R$ ${estadoCliente.saldoCarteiraCliente.toFixed(2).replace('.', ',')}`;
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar saldo da carteira:', err);
  }
}

export function verificarAcessoAdminMenu() {
  const token = localStorage.getItem('huby_token');
  const btnAdmin = document.getElementById('menuItemAdmin');
  
  if (!btnAdmin) return;
  if (!token) {
    btnAdmin.style.display = 'none';
    return;
  }

  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const payloadUser = JSON.parse(jsonPayload);
    const roleServidor = String(payloadUser.role || payloadUser.tipo || '').toLowerCase();

    if (roleServidor) localStorage.setItem('huby_user_role', roleServidor);

    if (roleServidor === 'admin' || roleServidor === 'administrador') {
      btnAdmin.style.display = 'flex';
    } else {
      btnAdmin.style.display = 'none';
    }
  } catch (e) {
    btnAdmin.style.display = 'none';
  }
}

export function configurarDrawerMenu() {
  const btnMenu = document.getElementById('btnAbrirMenu');
  const backdrop = document.getElementById('menuBackdrop');
  const perfilBox = document.getElementById('drawerPerfilBox');
  const btnAuth = document.getElementById('btnAcaoConta');

  const token = localStorage.getItem('huby_token');
  const userName = localStorage.getItem('huby_user_name') || 'Passageiro HUBy';
  const userPhone = localStorage.getItem('huby_user_phone') || 'Conta cadastrada';

  if (perfilBox && btnAuth) {
    if (token) {
      perfilBox.innerHTML = `
        <div class="profile-card-logged">
          <div class="profile-avatar">${userName.charAt(0).toUpperCase()}</div>
          <div class="profile-meta">
            <strong>${userName}</strong>
            <small>${userPhone}</small>
            <div style="margin-top:4px; font-size:12px; color:#10B981; font-weight:700;">
              Saldo: <span id="lblSaldoCarteira">R$ ${estadoCliente.saldoCarteiraCliente.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>
        </div>
      `;
      btnAuth.textContent = 'Sair da Conta';
      btnAuth.classList.add('btn-sair');
      btnAuth.onclick = () => {
        localStorage.clear();
        window.location.reload();
      };
    } else {
      perfilBox.innerHTML = `
        <h4 class="profile-guest-title">Bem-vindo ao HUBy</h4>
        <p class="profile-guest-sub">Entre para pedir viagens mais rápido e usar sua carteira digital.</p>
      `;
      btnAuth.textContent = 'Entrar ou Cadastrar';
      btnAuth.classList.remove('btn-sair');
      btnAuth.onclick = () => {
        window.location.href = './login.html';
      };
    }
  }

  btnMenu?.addEventListener('click', () => {
    verificarAcessoAdminMenu();
    abrirDrawer();
  });
  backdrop?.addEventListener('click', fecharDrawer);
}

export function abrirDrawer() {
  document.getElementById('drawerMenu')?.classList.add('active');
  document.getElementById('menuBackdrop')?.classList.add('active');
}

export function fecharDrawer() {
  document.getElementById('drawerMenu')?.classList.remove('active');
  document.getElementById('menuBackdrop')?.classList.remove('active');
}

export async function carregarEExibirHistoricoModal() {
  const token = localStorage.getItem('huby_token');
  const modal = document.getElementById('modalHistorico');
  const container = document.getElementById('listaHistoricoCorridas');

  if (!token) {
    window.location.href = './login.html';
    return;
  }

  if (modal) modal.style.display = 'flex';
  if (container) container.innerHTML = '<p class="loading-txt">Carregando viagens...</p>';

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error('Não foi possível obter o histórico.');

    const viagens = await resp.json();
    if (!viagens || viagens.length === 0) {
      container.innerHTML = '<p class="loading-txt">Você ainda não realizou nenhuma corrida.</p>';
      return;
    }

    container.innerHTML = viagens.map(v => `
      <div class="card-historico-item">
        <div class="h-row">
          <span class="h-title">${v.sub_tipo_label || 'Viagem HUBy'}</span>
          <span class="h-val">R$ ${Number(v.valor_total).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="h-route">${v.distancia_km} km • ${v.status}</div>
      </div>
    `).join('');
  } catch (err) {
    if (container) container.innerHTML = `<p class="loading-txt" style="color: #EF4444;">${err.message}</p>`;
  }
}