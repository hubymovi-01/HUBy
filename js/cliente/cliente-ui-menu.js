// js/cliente/cliente-ui-menu.js - Menu Lateral, Perfil, Histórico e Carteira Pix HUBy
// Segurança: nome, telefone, endereços e nome do motorista são exibidos como texto puro.
import { API_URL, OPCOES_RECARGA_PIX, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';
import { notificar } from '../util/alertas-huby.js';

let intervalPollingPix = null;

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Só aceita imagem em base64 ou link https
function imagemSegura(url) {
  const s = String(url || '').trim();
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]{5,800}$/.test(s)) return s;
  return '';
}

function reais(valor) {
  const n = Number(valor);
  return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;
}

function papelSalvo() {
  return String(localStorage.getItem('huby_user_role') || '').toLowerCase().trim();
}

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

      document.querySelectorAll('#lblSaldoCarteira, .lbl-saldo-dinamico').forEach((el) => {
        el.textContent = reais(estadoCliente.saldoCarteiraCliente);
      });
    }
  } catch (err) {
    console.warn('Erro ao consultar saldo da carteira:', err);
  }
}

// Botão do painel admin no menu: aparece só para quem entrou como admin.
// (Quem decide o acesso de verdade é o servidor; aqui é só para mostrar ou esconder o botão.)
export function verificarAcessoAdminMenu() {
  const btnAdmin = document.getElementById('menuItemAdmin');
  if (!btnAdmin) return;

  const token = localStorage.getItem('huby_token');
  const papel = papelSalvo();
  const ehAdmin = Boolean(token) && (papel === 'admin' || papel === 'administrador');
  btnAdmin.style.setProperty('display', ehAdmin ? 'flex' : 'none', 'important');
}

// Cabeçalho do menu (foto, nome, telefone, tipo de conta e saldo) montado com texto puro
function renderizarCabecalhoPerfil(perfilBox) {
  const nome = String(localStorage.getItem('huby_user_name') || 'Passageiro HUBy').trim().slice(0, 60) || 'Passageiro HUBy';
  const telefone = String(localStorage.getItem('huby_user_phone') || '').trim().slice(0, 20);
  const foto = imagemSegura(localStorage.getItem('huby_user_foto'));
  const papel = papelSalvo();
  const ehAdmin = papel === 'admin' || papel === 'administrador';
  const tipoConta = ehAdmin ? 'Administrador Master' : (papel === 'motorista' ? 'Motorista Parceiro' : 'Conta verificada');

  const cartao = document.createElement('div');
  cartao.className = 'profile-card-logged';
  cartao.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); background: linear-gradient(180deg, rgba(16, 185, 129, 0.05) 0%, transparent 100%);';

  let avatar;
  if (foto) {
    avatar = document.createElement('img');
    avatar.src = foto;
    avatar.alt = 'Foto de perfil';
    avatar.style.cssText = 'width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 2px solid #10B981; flex-shrink: 0;';
  } else {
    avatar = document.createElement('div');
    avatar.className = 'profile-avatar';
    avatar.style.cssText = 'width: 50px; height: 50px; border-radius: 50%; background: #121826; border: 2px solid #10B981; color: #10B981; font-weight: 900; font-size: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
    avatar.textContent = nome.charAt(0).toUpperCase();
  }

  const meta = document.createElement('div');
  meta.className = 'profile-meta';
  meta.style.cssText = 'flex: 1; min-width: 0;';

  const elNome = document.createElement('strong');
  elNome.style.cssText = 'color: #FFF; font-size: 15px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  elNome.textContent = nome;

  const elTipo = document.createElement('small');
  elTipo.style.cssText = `display: block; color: ${ehAdmin ? '#F87171' : '#94A3B8'}; font-size: 12px; font-weight: 600;`;
  elTipo.textContent = telefone ? `${tipoConta} • ${telefone}` : tipoConta;

  const elSaldo = document.createElement('div');
  elSaldo.style.cssText = 'margin-top: 4px; font-size: 13px; color: #10B981; font-weight: 800;';
  elSaldo.textContent = 'Saldo: ';
  const valorSaldo = document.createElement('span');
  valorSaldo.id = 'lblSaldoCarteira';
  valorSaldo.textContent = reais(estadoCliente.saldoCarteiraCliente || 0);
  elSaldo.appendChild(valorSaldo);

  meta.append(elNome, elTipo, elSaldo);
  cartao.append(avatar, meta);
  perfilBox.replaceChildren(cartao);
}

// Sair: apaga só o login; Casa, Trabalho e preferências do aparelho continuam salvos
function sairDaConta() {
  if (estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id')) {
    notificar('Você tem uma corrida em andamento. Finalize ou cancele antes de sair da conta.', 'alerta');
    return;
  }
  const manter = /^huby_(endereco_|coords_|meus_agendamentos|regiao|ia_)/;
  Object.keys(localStorage)
    .filter((chave) => chave.startsWith('huby_') && !manter.test(chave))
    .forEach((chave) => localStorage.removeItem(chave));
  try { sessionStorage.clear(); } catch (e) {}
  window.location.replace('./login.html');
}

export function configurarDrawerMenu() {
  const btnMenu = document.getElementById('btnAbrirMenu');
  const backdrop = document.getElementById('menuBackdrop');
  const perfilBox = document.getElementById('drawerPerfilBox');
  const btnAuth = document.getElementById('btnAcaoConta');
  const token = localStorage.getItem('huby_token');

  if (perfilBox && token) {
    renderizarCabecalhoPerfil(perfilBox);
  } else if (perfilBox) {
    perfilBox.innerHTML = `
      <div style="padding: 16px;">
        <h4 class="profile-guest-title" style="margin: 0 0 6px 0; color: #FFF;">Bem-vindo ao HUBy</h4>
        <p class="profile-guest-sub" style="margin: 0; color: #94A3B8; font-size: 13px;">Entre para pedir viagens mais rápido.</p>
      </div>
    `;
  }

  if (btnAuth) {
    if (token) {
      btnAuth.textContent = 'Sair da Conta';
      btnAuth.classList.add('btn-sair');
      btnAuth.onclick = sairDaConta;
    } else {
      btnAuth.textContent = 'Entrar ou Cadastrar';
      btnAuth.classList.remove('btn-sair');
      btnAuth.onclick = () => { window.location.href = './login.html'; };
    }
  }

  verificarAcessoAdminMenu();

  btnMenu?.addEventListener('click', () => {
    if (perfilBox && localStorage.getItem('huby_token')) renderizarCabecalhoPerfil(perfilBox);
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

  const valores = (Array.isArray(OPCOES_RECARGA_PIX) ? OPCOES_RECARGA_PIX : [])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);

  modalCard.innerHTML = `
    <div class="modal-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0; color: #FFF; font-size: 18px;">💳 Carteira Digital HUBy</h3>
      <button type="button" id="btnFecharPagamentoInterno" class="btn-icon-close" style="background: transparent; border: none; color: #94A3B8; font-size: 20px; cursor: pointer;">✕</button>
    </div>

    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 78, 59, 0.25) 100%); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 14px; margin-bottom: 16px; text-align: center;">
      <span style="font-size: 12px; color: #94A3B8; font-weight: 700; text-transform: uppercase;">Saldo Disponível</span>
      <h2 style="font-size: 26px; color: #10B981; margin: 4px 0 0 0; font-weight: 900;">${reais(estadoCliente.saldoCarteiraCliente || 0)}</h2>
    </div>

    <span style="font-size: 12px; color: #E2E8F0; font-weight: 700;">Adicionar saldo via Pix:</span>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px 0;">
      ${valores.map((val) => `
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
    if (intervalPollingPix) {
      clearInterval(intervalPollingPix);
      intervalPollingPix = null;
    }
  });

  modalCard.querySelectorAll('.btn-recarga-rapida').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await gerarCobrancaPixCliente(Number(btn.getAttribute('data-valor')));
    });
  });
}

async function gerarCobrancaPixCliente(valor) {
  const token = localStorage.getItem('huby_token');
  if (!token) {
    notificar('Entre na sua conta para fazer recargas.', 'alerta');
    return;
  }

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

    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.erro || 'Falha ao gerar Pix.');

    const qr = imagemSegura(dados.qrCodeUrl);
    if (imgQr && qr) imgQr.src = qr;
    if (inputCopia) inputCopia.value = String(dados.copiaCola || '');
    if (txtStatus) txtStatus.textContent = `⏳ Aguardando pagamento de ${reais(dados.valor ?? valor)}...`;

    if (btnCopiar) {
      btnCopiar.onclick = async () => {
        try {
          await navigator.clipboard.writeText(String(dados.copiaCola || ''));
          notificar('Código Pix copiado!', 'sucesso');
        } catch (e) {
          inputCopia?.select();
        }
      };
    }

    if (intervalPollingPix) clearInterval(intervalPollingPix);
    intervalPollingPix = setInterval(async () => {
      try {
        const resChecagem = await fetch(`${API_URL}/api/carteira/pix/status/${encodeURIComponent(dados.txid)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resChecagem.ok) {
          const statusDados = await resChecagem.json();
          if (statusDados.status === 'pago') {
            clearInterval(intervalPollingPix);
            intervalPollingPix = null;
            if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
            notificar('🎉 Pagamento confirmado! Saldo atualizado.', 'sucesso');
            await carregarSaldoCarteiraCliente();
            renderizarPainelRecargaPix();
          }
        }
      } catch (e) {}
    }, 4000);
  } catch (err) {
    notificar(err instanceof TypeError ? 'Sem conexão. O Pix não foi gerado.' : err.message, 'erro');
    if (areaPix) areaPix.style.display = 'none';
  }
}

const ROTULOS_STATUS = {
  concluido: ['Concluída', '#10B981'],
  a_caminho: ['Motorista a caminho', '#38BDF8'],
  aceito: ['Motorista a caminho', '#38BDF8'],
  chegou_local: ['Motorista no local', '#38BDF8'],
  em_andamento: ['Em viagem', '#10B981'],
  em_viagem: ['Em viagem', '#10B981'],
  cancelado: ['Cancelada', '#EF4444']
};

export async function carregarEExibirHistoricoModal() {
  const token = localStorage.getItem('huby_token');
  const modal = document.getElementById('modalHistorico');
  const container = document.getElementById('listaHistoricoCorridas');

  if (!token) {
    window.location.href = './login.html';
    return;
  }

  if (modal) modal.style.display = 'flex';
  if (!container) return;
  container.innerHTML = '<p class="loading-txt" style="text-align:center;color:#94A3B8;padding:16px;">Carregando viagens...</p>';

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error('Não foi possível obter o histórico.');

    const dados = await resp.json();
    const viagens = Array.isArray(dados) ? dados : (Array.isArray(dados?.viagens) ? dados.viagens : []);
    if (viagens.length === 0) {
      container.innerHTML = '<p class="loading-txt" style="text-align:center;color:#94A3B8;padding:16px;">Você ainda não realizou nenhuma corrida.</p>';
      return;
    }

    container.innerHTML = viagens.slice(0, 100).map((v) => {
      const st = String(v.status || '').toLowerCase();
      const [statusFormatado, statusCor] = ROTULOS_STATUS[st] || ['Pendente', '#F59E0B'];
      const dist = Number(v.distancia_km);
      const distTxt = Number.isFinite(dist) && dist > 0 ? `${dist.toFixed(1).replace('.', ',')} km` : '-- km';
      const motorista = v.motorista_nome
        ? ` • Motorista: <strong>${escaparHTML(String(v.motorista_nome).slice(0, 60))}</strong>`
        : '';
      const dataObj = v.criado_em ? new Date(v.criado_em) : null;
      const dataTxt = dataObj && Number.isFinite(dataObj.getTime())
        ? dataObj.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';

      return `
        <div class="card-historico-item" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; margin-bottom: 12px;">
          <div class="h-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px;">
            <span class="h-title" style="font-weight: 800; color: #FFF; font-size: 14px;">${escaparHTML(String(v.sub_tipo_label || 'Viagem HUBy').slice(0, 40))}</span>
            <span class="h-val" style="color: #10B981; font-weight: 900; font-size: 15px; flex-shrink: 0;">${reais(v.valor_total)}</span>
          </div>

          <div style="font-size: 12px; color: #E2E8F0; margin-bottom: 4px; line-height: 1.4; word-break: break-word;">
            📍 <strong>Destino:</strong> ${escaparHTML(String(v.destino_endereco || 'Destino informado').slice(0, 160))}
          </div>
          ${dataTxt ? `<div style="font-size: 11px; color: #64748B;">${escaparHTML(dataTxt)}</div>` : ''}

          <div class="h-route" style="font-size: 11px; color: #94A3B8; display: flex; justify-content: space-between; align-items: center; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 6px; gap: 8px;">
            <span>${distTxt}${motorista}</span>
            <span style="color: ${statusCor}; font-weight: 800; text-transform: uppercase; flex-shrink: 0;">● ${statusFormatado}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p class="loading-txt" style="color: #EF4444; text-align:center; padding:16px;">Não foi possível carregar suas viagens agora.</p>';
  }
}