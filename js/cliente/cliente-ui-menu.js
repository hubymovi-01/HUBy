// js/cliente/cliente-ui-menu.js - Menu Lateral, Perfil e Carteira Pix HUBy
import { API_URL, OPCOES_RECARGA_PIX, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';

let intervalPollingPix = null;

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

      const elementosSaldo = document.querySelectorAll('#lblSaldoCarteira, .lbl-saldo-dinamico');
      elementosSaldo.forEach(el => {
        el.textContent = `R$ ${estadoCliente.saldoCarteiraCliente.toFixed(2).replace('.', ',')}`;
      });
    }
  } catch (err) {
    console.warn('Erro ao consultar saldo da carteira:', err);
  }
}

// CONTROLE DE ACESSO AO PAINEL ADMIN NO MENU
export function verificarAcessoAdminMenu() {
  const btnAdmin = document.getElementById('menuItemAdmin');
  if (!btnAdmin) return;

  const token = localStorage.getItem('huby_token');
  if (!token) {
    btnAdmin.style.setProperty('display', 'none', 'important');
    return;
  }

  let ehAdmin = false;

  // 1. Checa pelo localStorage
  const roleLocal = String(localStorage.getItem('huby_user_role') || '').toLowerCase().trim();
  if (roleLocal === 'admin' || roleLocal === 'administrador') {
    ehAdmin = true;
  }

  // 2. Checa pelo payload do token JWT
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const roleJwt = String(payload.role || payload.funcao || payload['função'] || '').toLowerCase().trim();
    if (roleJwt === 'admin' || roleJwt === 'administrador') {
      ehAdmin = true;
      localStorage.setItem('huby_user_role', 'admin');
    }
  } catch (e) {}

  if (ehAdmin) {
    btnAdmin.style.setProperty('display', 'flex', 'important');
  } else {
    btnAdmin.style.setProperty('display', 'none', 'important');
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
        <div class="profile-card-logged" style="display: flex; align-items: center; gap: 12px; padding: 18px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <div class="profile-avatar" style="width: 48px; height: 48px; border-radius: 50%; background: #10B981; color: #000; font-weight: 800; font-size: 20px; display: flex; align-items: center; justify-content: center;">
            ${userName.charAt(0).toUpperCase()}
          </div>
          <div class="profile-meta" style="flex: 1;">
            <strong style="color: #FFF; font-size: 15px; display: block;">${userName}</strong>
            <small style="color: #94A3B8; font-size: 12px;">${userPhone}</small>
            <div style="margin-top: 4px; font-size: 13px; color: #10B981; font-weight: 800;">
              Saldo: <span id="lblSaldoCarteira">R$ ${(estadoCliente.saldoCarteiraCliente || 0).toFixed(2).replace('.', ',')}</span>
            </div>
          </div>
        </div>
      `;
      btnAuth.textContent = 'Sair da Conta';
      btnAuth.classList.add('btn-sair');
      btnAuth.onclick = () => {
        localStorage.clear();
        window.location.replace('./login.html');
      };
    } else {
      perfilBox.innerHTML = `
        <div style="padding: 16px;">
          <h4 class="profile-guest-title" style="margin: 0 0 6px 0; color: #FFF;">Bem-vindo ao HUBy</h4>
          <p class="profile-guest-sub" style="margin: 0; color: #94A3B8; font-size: 13px;">Entre para pedir viagens mais rápido.</p>
        </div>
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
    carregarSaldoCarteiraCliente();
    abrirDrawer();
  });
  backdrop?.addEventListener('click', fecharDrawer);

  configurarModalCarteiraPix();
}

export function abrirDrawer() {
  document.getElementById('drawerMenu')?.classList.add('active');
  document.getElementById('menuBackdrop')?.classList.add('active');
}

export function fecharDrawer() {
  document.getElementById('drawerMenu')?.classList.remove('active');
  document.getElementById('menuBackdrop')?.classList.remove('active');
}

export function configurarModalCarteiraPix() {
  const modal = document.getElementById('modalPagamento');
  const btnMenuPagamento = document.getElementById('menuItemPagamentos');
  const btnFechar = document.getElementById('btnFecharPagamento');

  btnMenuPagamento?.addEventListener('click', (e) => {
    e.preventDefault();
    fecharDrawer();
    renderizarPainelRecargaPix();
    if (modal) modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    if (intervalPollingPix) {
      clearInterval(intervalPollingPix);
      intervalPollingPix = null;
    }
  });
}

function renderizarPainelRecargaPix() {
  const modalCard = document.querySelector('#modalPagamento .modal-card');
  if (!modalCard) return;

  const saldoFormatado = (estadoCliente.saldoCarteiraCliente || 0).toFixed(2).replace('.', ',');

  modalCard.innerHTML = `
    <div class="modal-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0; color: #FFF; font-size: 18px;">💳 Carteira Digital HUBy</h3>
      <button type="button" id="btnFecharPagamentoInterno" class="btn-icon-close" style="background: transparent; border: none; color: #94A3B8; font-size: 20px; cursor: pointer;">✕</button>
    </div>

    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 78, 59, 0.25) 100%); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 14px; margin-bottom: 16px; text-align: center;">
      <span style="font-size: 12px; color: #94A3B8; font-weight: 700; text-transform: uppercase;">Saldo Disponível</span>
      <h2 style="font-size: 26px; color: #10B981; margin: 4px 0 0 0; font-weight: 900;">R$ ${saldoFormatado}</h2>
    </div>

    <span style="font-size: 12px; color: #E2E8F0; font-weight: 700;">Adicionar saldo via Pix Dinâmico:</span>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px 0;">
      ${OPCOES_RECARGA_PIX.map(val => `
        <button type="button" class="btn-recarga-rapida" data-valor="${val}" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #FFF; padding: 10px 4px; border-radius: 8px; font-weight: 800; font-size: 13px; cursor: pointer;">
          +R$ ${val}
        </button>
      `).join('')}
    </div>

    <div id="areaPixGerado" style="display: none; background: rgba(0,0,0,0.3); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px; padding: 14px; text-align: center; margin-top: 10px;">
      <span style="font-size: 12px; color: #38BDF8; font-weight: 800;">Aponte o app do seu banco ou copie o código:</span>
      <div style="display: flex; justify-content: center; margin: 12px 0;">
        <img id="imgPixQrCode" src="" alt="QR Code Pix" style="width: 170px; height: 170px; border-radius: 8px; background: #FFF; padding: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);" />
      </div>

      <input type="text" id="inputPixCopiaCola" readonly style="width: 100%; background: #090D16; border: 1px solid rgba(255,255,255,0.15); color: #94A3B8; padding: 8px 10px; border-radius: 6px; font-size: 11px; margin-bottom: 8px; box-sizing: border-box; text-overflow: ellipsis;" />

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnCopiarCopiaCola" style="flex: 1; background: #38BDF8; color: #000; border: none; padding: 10px; border-radius: 8px; font-weight: 800; font-size: 13px; cursor: pointer;">📋 Copiar Código</button>
      </div>
      <div id="txtStatusAguardandoPix" style="font-size: 11px; color: #F59E0B; margin-top: 8px;">⏳ Aguardando confirmação do banco...</div>
    </div>
  `;

  document.getElementById('btnFecharPagamentoInterno')?.addEventListener('click', () => {
    const modal = document.getElementById('modalPagamento');
    if (modal) modal.style.display = 'none';
    if (intervalPollingPix) clearInterval(intervalPollingPix);
  });

  modalCard.querySelectorAll('.btn-recarga-rapida').forEach(btn => {
    btn.addEventListener('click', async () => {
      const valor = Number(btn.getAttribute('data-valor'));
      await gerarCobrancaPixCliente(valor);
    });
  });
}

async function gerarCobrancaPixCliente(valor) {
  const token = localStorage.getItem('huby_token');
  if (!token) return alert('Inicie sessão para efetuar recargas.');

  const areaPix = document.getElementById('areaPixGerado');
  const imgQr = document.getElementById('imgPixQrCode');
  const inputCopia = document.getElementById('inputPixCopiaCola');
  const btnCopiar = document.getElementById('btnCopiarCopiaCola');
  const txtStatus = document.getElementById('txtStatusAguardandoPix');

  try {
    if (txtStatus) txtStatus.textContent = 'Gerando cobrança Pix...';
    if (areaPix) areaPix.style.display = 'block';

    const resp = await fetch(`${API_URL}/api/carteira/pix/gerar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ valor })
    });

    if (!resp.ok) throw new Error('Falha ao gerar Pix');
    const dados = await resp.json();

    if (imgQr) imgQr.src = dados.qrCodeUrl;
    if (inputCopia) inputCopia.value = dados.copiaCola;
    if (txtStatus) txtStatus.textContent = `⏳ Aguardando pagamento de R$ ${dados.valor.toFixed(2).replace('.', ',')}...`;

    btnCopiar.onclick = () => {
      inputCopia.select();
      navigator.clipboard.writeText(dados.copiaCola);
      alert('Código Pix Copia e Cola copiado com sucesso!');
    };

    if (intervalPollingPix) clearInterval(intervalPollingPix);
    intervalPollingPix = setInterval(async () => {
      try {
        const resChecagem = await fetch(`${API_URL}/api/carteira/pix/status/${dados.txid}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resChecagem.ok) {
          const statusDados = await resChecagem.json();
          if (statusDados.status === 'pago') {
            clearInterval(intervalPollingPix);
            intervalPollingPix = null;
            sonsHUBy.tocarSucessoAceite();
            alert('🎉 Pagamento confirmado!');
            carregarSaldoCarteiraCliente();
            renderizarPainelRecargaPix();
          }
        }
      } catch (e) {}
    }, 4000);

  } catch (err) {
    alert('Erro ao gerar Pix.');
    if (areaPix) areaPix.style.display = 'none';
  }
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
  if (container) container.innerHTML = '<p class="loading-txt" style="text-align:center;color:#94A3B8;padding:16px;">Carregando viagens...</p>';

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error('Não foi possível obter o histórico.');

    const viagens = await resp.json();
    if (!viagens || viagens.length === 0) {
      container.innerHTML = '<p class="loading-txt" style="text-align:center;color:#94A3B8;padding:16px;">Você ainda não realizou nenhuma corrida.</p>';
      return;
    }

    container.innerHTML = viagens.map(v => {
      let statusFormatado = 'Pendente';
      let statusCor = '#F59E0B';

      if (v.status === 'concluido') {
        statusFormatado = 'Concluída';
        statusCor = '#10B981';
      } else if (v.status === 'a_caminho' || v.status === 'em_andamento' || v.status === 'aceito') {
        statusFormatado = 'Motorista a caminho';
        statusCor = '#38BDF8';
      } else if (v.status === 'em_viagem') {
        statusFormatado = 'Em viagem';
        statusCor = '#10B981';
      } else if (v.status === 'cancelado') {
        statusFormatado = 'Cancelada';
        statusCor = '#EF4444';
      }

      const motoristaInfo = v.motorista_nome ? `• Motorista: <strong>${v.motorista_nome}</strong>` : '';

      return `
        <div class="card-historico-item" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; margin-bottom: 12px;">
          <div class="h-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span class="h-title" style="font-weight: 800; color: #FFF; font-size: 14px;">${v.sub_tipo_label || 'Viagem HUBy'}</span>
            <span class="h-val" style="color: #10B981; font-weight: 900; font-size: 15px;">R$ ${Number(v.valor_total).toFixed(2).replace('.', ',')}</span>
          </div>

          <div style="font-size: 12px; color: #E2E8F0; margin-bottom: 4px; line-height: 1.4;">
            📍 <strong>Destino:</strong> ${v.destino_endereco || 'Destino informado'}
          </div>

          <div class="h-route" style="font-size: 11px; color: #94A3B8; display: flex; justify-content: space-between; align-items: center; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 6px;">
            <span>${v.distancia_km || '--'} km ${motoristaInfo}</span>
            <span style="color: ${statusCor}; font-weight: 800; text-transform: uppercase;">● ${statusFormatado}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    if (container) container.innerHTML = `<p class="loading-txt" style="color: #EF4444; text-align:center; padding:16px;">${err.message}</p>`;
  }
}