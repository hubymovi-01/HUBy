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

  if (!token || role !== 'motorista') {
    alert('Acesso restrito a condutores parceiros.');
    window.location.replace('./login.html');
    return;
  }

  // 1. Inicializa o mapa Leaflet
  try {
    estado.hubyMapa = new HubyMapa('mapaMotorista');
    estado.hubyMapa.inicializar();

    setTimeout(() => {
      if (estado.hubyMapa?.map) {
        estado.hubyMapa.map.invalidateSize();
      }
    }, 250);

    estado.hubyMapa.obterGPS((pos) => {
      if (estado.isOnline) {
        iniciarTransmissaoTelemetria(pos);
      }
    });
  } catch (err) {
    console.warn('Erro ao inicializar mapa:', err);
  }

  // 2. Configura os módulos da aplicação
  configurarToggleOnline();
  configurarDrawerPerfil();
  configurarModalSaquePix();
  configurarChatMotorista();
  configurarAjusteMetaDiaria();
  configurarSuporteEIncidentes();

  // 3. Ativa as ferramentas inteligentes (Calor, Pausa e Casa) conectadas ao mapa Leaflet
  const mapaInstancia = estado.hubyMapa?.map || estado.hubyMapa;
  configurarRecursosInteligentes(mapaInstancia, token);

  // 4. Carrega os dados iniciais do parceiro e ganhos
  await carregarPerfilCompleto();
  await carregarGanhosHoje();

  // 5. Limpeza ao sair da janela
  window.addEventListener('beforeunload', () => {
    pararRadarChamadas();
    pararTransmissaoTelemetria();
    if (estado.socketRadar) estado.socketRadar.disconnect();
    if (estado.hubyMapa?.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(estado.hubyMapa.watchId);
    }
  });
});