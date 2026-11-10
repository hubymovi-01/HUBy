/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Estabilizada de Produção com Validação de Sessão e Copiloto Hands-Free
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
import { inicializarCopilotoVoz, definirCodigoAtivacaoMotorista, obterCodigoAtivacaoMotorista } from './ia/motorista-ia.js';
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

// Configuração blindada do input e botão de salvar comando de voz
function configurarCodigoVozDireto() {
  const inputComando = document.getElementById('inputCodigoVozMotorista');
  const btnSalvarComando = document.getElementById('btnSalvarCodigoVoz');

  if (inputComando) {
    inputComando.value = obterCodigoAtivacaoMotorista();
  }

  if (btnSalvarComando && inputComando) {
    btnSalvarComando.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const valorDigitado = (inputComando.value || '').trim();

      if (!valorDigitado) {
        notificar('Digite uma frase para ativar seu copiloto (Ex: OK HUBy, OK Piloto).', 'alerta');
        inputComando.focus();
        return;
      }

      await definirCodigoAtivacaoMotorista(valorDigitado);
      notificar(`Comando "${valorDigitado}" salvo com sucesso!`, 'sucesso');
    });
  }
}

function registrarEventosUI() {
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', async () => {
    await alternarStatusOnline();
  });

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

  if (typeof configurarChatMotorista === 'function') configurarChatMotorista();
  if (typeof configurarEventosSaque === 'function') configurarEventosSaque();
  if (typeof configurarSalvarPreferenciasPagto === 'function') configurarSalvarPreferenciasPagto();
  if (typeof configurarEdicaoPerfil === 'function') configurarEdicaoPerfil();
  if (typeof configurarMarketplace === 'function') configurarMarketplace();
  if (typeof configurarModosInteligentes === 'function') configurarModosInteligentes();
  
  // Registra o salvamento sem falha de blur
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

  inicializarCopilotoVoz();
});