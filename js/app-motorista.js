/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 */

import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas } from './motorista/motorista-radar.js';
import { carregarPerfil, configurarSalvarPreferenciasPagto, configurarEdicaoPerfil } from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';
import { configurarMarketplace } from './motorista/motorista-loja.js';
import { inicializarPushNotifications } from './motorista/motorista-push.js';

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

  // Ações da Barra Superior (Modos Inteligentes)
  document.getElementById('btnToggleHeatmap')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('active');
  });

  document.getElementById('btnModoPausa')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('active');
  });

  document.getElementById('btnModoDestino')?.addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('active');
  });

  // Módulos especializados
  if (typeof configurarChatMotorista === 'function') configurarChatMotorista();
  if (typeof configurarEventosSaque === 'function') configurarEventosSaque();
  if (typeof configurarSalvarPreferenciasPagto === 'function') configurarSalvarPreferenciasPagto();
  if (typeof configurarEdicaoPerfil === 'function') configurarEdicaoPerfil();
  if (typeof configurarMarketplace === 'function') configurarMarketplace();
}

document.addEventListener('DOMContentLoaded', async () => {
  inicializarSocket();
  inicializarMapa();
  registrarEventosUI();
  await carregarPerfil();
  iniciarRadarChamadas();
  inicializarPushNotifications();
});