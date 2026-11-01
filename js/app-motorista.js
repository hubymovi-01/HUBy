// js/app-motorista.js - Orquestrador Principal HUBy Motorista
import { HubyMapa } from './mapa.js';
import { estado } from './motorista/motorista-estado.js';
import { configurarToggleOnline, iniciarTransmissaoTelemetria, pararTransmissaoTelemetria } from './motorista/motorista-online.js';
import { carregarGanhosHoje, configurarAjusteMetaDiaria } from './motorista/motorista-ganhos.js';
import { configurarDrawerPerfil, carregarPerfilCompleto, configurarModalSaquePix } from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { pararRadarChamadas } from './motorista/motorista-radar.js';
import { configurarSuporteEIncidentes } from './motorista/motorista-suporte.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || (role !== 'motorista' && role !== 'admin' && role !== 'administrador')) {
    alert('Acesso restrito a condutores parceiros.');
    window.location.replace('./login.html');
    return;
  }

  // 1. Inicializa o mapa Leaflet
  let mapaInstancia = null;
  try {
    estado.hubyMapa = new HubyMapa('mapaMotorista');
    estado.hubyMapa.inicializar();

    mapaInstancia = estado.hubyMapa?.map || estado.hubyMapa;

    setTimeout(() => {
      if (estado.hubyMapa?.map) {
        estado.hubyMapa.map.invalidateSize();
      }
    }, 300);

    estado.hubyMapa.obterGPS((pos) => {
      if (estado.isOnline) {
        iniciarTransmissaoTelemetria(pos);
      }
    });
  } catch (err) {
    console.warn('Aviso na inicialização do mapa do motorista:', err);
  }

  // 2. Configura os módulos essenciais da interface e operações
  configurarToggleOnline();
  configurarDrawerPerfil();
  configurarModalSaquePix();
  configurarChatMotorista();
  configurarAjusteMetaDiaria();
  configurarSuporteEIncidentes();

  // 3. Ativa ferramentas inteligentes conectadas ao mapa (Calor, Pausa e Casa)
  try {
    configurarRecursosInteligentes(mapaInstancia, token);
  } catch (errRecursos) {
    console.warn('Recursos inteligentes aguardando renderização do mapa:', errRecursos);
  }

  // 4. Carrega os dados do condutor e o progresso da meta diária em paralelo
  await Promise.allSettled([
    carregarPerfilCompleto(),
    carregarGanhosHoje()
  ]);

  // 5. Limpeza de sockets, radares e telemetria ao sair
  window.addEventListener('beforeunload', () => {
    pararRadarChamadas();
    pararTransmissaoTelemetria();
    if (estado.socketRadar) {
      estado.socketRadar.disconnect();
    }
    if (estado.hubyMapa?.watchId !== null && estado.hubyMapa?.watchId !== undefined && navigator.geolocation) {
      navigator.geolocation.clearWatch(estado.hubyMapa.watchId);
    }
  });
});