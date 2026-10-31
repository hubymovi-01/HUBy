// js/motorista/motorista-principal.js
import { estado } from './motorista-estado.js';
import { HubyMapa } from '../mapa.js';
import { carregarPerfilCompleto } from './motorista-perfil.js';
import { carregarGanhosHoje } from './motorista-ganhos.js';
import { alternarStatusOnline, iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';
import { ativarWakeLock, liberarWakeLock, inicializarMonitorConexao } from './motorista-utilidades.js';

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  // Validação de autenticação para o condutor
  if (!token || (role !== 'motorista' && role !== 'condutor')) {
    alert('Acesso restrito ao perfil de motorista parceiro.');
    window.location.replace('./login.html');
    return;
  }

  // 1. Inicializa o monitor de rede offline/online
  inicializarMonitorConexao();

  // 2. Inicializa o mapa base na vista do motorista
  try {
    estado.hubyMapa = new HubyMapa('mapaMotoristaContainer');
    estado.hubyMapa.inicializar();
  } catch (err) {
    console.warn('Erro ao inicializar mapa do motorista:', err);
  }

  // 3. Carrega informações de perfil e histórico de ganhos de hoje
  await carregarPerfilCompleto();
  await carregarGanhosHoje();

  // 4. Configura os listeners dos botões principais
  configurarBotoesAcao();

  // 5. Se já estava marcado como online anteriormente, restaura o estado e o Wake Lock
  const statusSalvo = localStorage.getItem('huby_motorista_online') === 'true';
  if (statusSalvo) {
    ativarEstadoOnlineVisual(true);
    ativarWakeLock();
    iniciarRadarChamadas();
  }
});

function configurarBotoesAcao() {
  const btnToggleStatus = document.getElementById('btnToggleStatusOnline');
  const btnSolicitarSaque = document.getElementById('btnSolicitarSaquePix');
  const btnCalor = document.getElementById('btnModoCalor');
  const btnSair = document.getElementById('btnSairMotorista');

  // Alternar entre Online e Offline
  btnToggleStatus?.addEventListener('click', async () => {
    const novoStatusOnline = await alternarStatusOnline();

    if (novoStatusOnline) {
      ativarWakeLock();
      localStorage.setItem('huby_motorista_online', 'true');
      iniciarRadarChamadas();
    } else {
      liberarWakeLock();
      localStorage.setItem('huby_motorista_online', 'false');
      pararRadarChamadas();
    }

    ativarEstadoOnlineVisual(novoStatusOnline);
  });

  // Solicitar Saque Pix
  btnSolicitarSaque?.addEventListener('click', () => {
    const modalSaque = document.getElementById('modalSaquePix');
    if (modalSaque) {
      modalSaque.style.display = 'flex';
    }
  });

  // Fechar sessão
  btnSair?.addEventListener('click', () => {
    if (confirm('Deseja realmente terminar a sessão e ficar offline?')) {
      liberarWakeLock();
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_motorista_online');
      window.location.replace('./login.html');
    }
  });

  // Mapa de calor (zonas de alta procura)
  btnCalor?.addEventListener('click', () => {
    estado.modoCalorAtivo = !estado.modoCalorAtivo;
    btnCalor.style.background = estado.modoCalorAtivo ? '#F59E0B' : 'rgba(255,255,255,0.06)';
    btnCalor.style.color = estado.modoCalorAtivo ? '#000' : 'var(--text-sec)';
    if (estado.hubyMapa && estado.hubyMapa.alternarCamadaCalor) {
      estado.hubyMapa.alternarCamadaCalor(estado.modoCalorAtivo);
    }
  });
}

function ativarEstadoOnlineVisual(online) {
  const btnToggleStatus = document.getElementById('btnToggleStatusOnline');
  if (!btnToggleStatus) return;

  if (online) {
    btnToggleStatus.innerHTML = `🟢 Você está Online`;
    btnToggleStatus.style.background = '#10B981';
    btnToggleStatus.style.color = '#022C22';
  } else {
    btnToggleStatus.innerHTML = `⚪ Ficar Online`;
    btnToggleStatus.style.background = 'rgba(255, 255, 255, 0.08)';
    btnToggleStatus.style.color = '#FFF';
  }
}