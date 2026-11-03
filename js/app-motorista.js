/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 */

import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas } from './motorista/motorista-radar.js';
import { carregarPerfil, configurarSalvarPreferenciasPagto } from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';

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
  configurarChatMotorista();
  configurarEventosSaque();
  configurarSalvarPreferenciasPagto();
}

document.addEventListener('DOMContentLoaded', () => {
  inicializarSocket();
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
  iniciarRadarChamadas();
});