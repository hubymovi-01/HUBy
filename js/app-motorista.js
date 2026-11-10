/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Estabilizada de Produção com Validação de Sessão e Copiloto Hands-Free
 */

import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas } from './motorista/motorista-radar.js';
import { 
  carregarPerfil, 
  configurarSalvarPreferenciasPagto, 
  configurarEdicaoPerfil, 
  configurarCodigoVozCopiloto 
} from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';
import { configurarMarketplace } from './motorista/motorista-loja.js';
import { inicializarPushNotifications } from './motorista/motorista-push.js';
import { configurarModosInteligentes } from './motorista/motorista-modos.js';
import { inicializarCopilotoVoz, ativarEscutaCopiloto } from './ia/motorista-ia.js';

// Barreira de autenticação antes de carregar o ecossistema do motorista
function validarAutenticacaoMotorista() {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || token === 'null' || token === 'undefined') {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  if (role && role !== 'motorista' && role !== 'admin') {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  return true;
}

function registrarEventosUI() {
  // Alternar Online / Offline
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', async () => {
    await alternarStatusOnline();
  });

  // Drawer Lateral
  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');

  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
  });

  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };

  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  // Módulos especializados
  if (typeof configurarChatMotorista === 'function') configurarChatMotorista();
  if (typeof configurarEventosSaque === 'function') configurarEventosSaque();
  if (typeof configurarSalvarPreferenciasPagto === 'function') configurarSalvarPreferenciasPagto();
  if (typeof configurarEdicaoPerfil === 'function') configurarEdicaoPerfil();
  if (typeof configurarMarketplace === 'function') configurarMarketplace();
  if (typeof configurarModosInteligentes === 'function') configurarModosInteligentes();
  if (typeof configurarCodigoVozCopiloto === 'function') configurarCodigoVozCopiloto();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!validarAutenticacaoMotorista()) return;

  inicializarSocket();
  inicializarMapa();
  registrarEventosUI();
  await carregarPerfil();
  iniciarRadarChamadas();
  inicializarPushNotifications();

  // Inicia o Copiloto por Voz com o código pessoal do condutor
  inicializarCopilotoVoz();
  ativarEscutaCopiloto();
});