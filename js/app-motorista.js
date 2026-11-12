/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Estabilizada de Produção com Validação de Sessão e Copiloto no Menu Lateral
 */

import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas } from './motorista/motorista-radar.js';
import { 
  carregarPerfil, 
  configurarSalvarPreferenciasPagto, 
  configurarEdicaoPerfil 
} from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';
import { configurarMarketplace } from './motorista/motorista-loja.js';
import { inicializarPushNotifications } from './motorista/motorista-push.js';
import { configurarModosInteligentes } from './motorista/motorista-modos.js';
import {
  inicializarCopilotoVoz,
  definirCodigoAtivacaoMotorista,
  obterCodigoAtivacaoMotorista,
  falarTexto,
  restaurarPreferenciaCopiloto
} from './ia/motorista-ia.js';
import { notificar } from './util/alertas-huby.js';

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

function configurarCodigoVozDireto() {
  const inputComando = document.getElementById('drawerInputCodigoVoz') || document.getElementById('inputCodigoVozMotorista');
  const btnSalvarComando = document.getElementById('btnSalvarCodigoVoz');
  const btnTestarComando = document.getElementById('btnTestarCodigoVoz');

  if (inputComando) {
    inputComando.value = obterCodigoAtivacaoMotorista();
  }

  if (btnSalvarComando && inputComando) {
    btnSalvarComando.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const valorDigitado = (inputComando.value || '').trim();

      if (!valorDigitado) {
        notificar('Digite uma palavra-chave para ativar seu copiloto (Ex: Zanix, Zank, Falcão).', 'alerta');
        inputComando.focus();
        return;
      }

      await definirCodigoAtivacaoMotorista(valorDigitado);
      notificar(`Comando "${valorDigitado}" salvo com sucesso!`, 'sucesso');
    });
  }

  if (btnTestarComando && inputComando) {
    btnTestarComando.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comandoAtual = (inputComando.value || '').trim() || obterCodigoAtivacaoMotorista();
      falarTexto(`Olá parceiro! Essa é a minha voz configurada. Basta me chamar por ${comandoAtual}.`);
    });
  }
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
  
  // Registro dos eventos de voz no menu lateral
  configurarCodigoVozDireto();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!validarAutenticacaoMotorista()) return;

  inicializarSocket();
  inicializarMapa();
  registrarEventosUI();
  await carregarPerfil();
  iniciarRadarChamadas();
  inicializarPushNotifications();

  // Inicializa os controles do copiloto no menu lateral e restaura a preferência salva
  inicializarCopilotoVoz();
  restaurarPreferenciaCopiloto();
});