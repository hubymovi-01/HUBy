// js/motorista/motorista-suporte.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';

export function configurarSuporteEIncidentes() {
  configurarFiltroDirecaoCasa();
  configurarBotaoSos();
  configurarModalIncidentes();
}

function configurarBotaoSos() {
  document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'btnSosMotorista') {
      if (!estado.pedidoAceitoAtual) {
        alert('O alerta SOS só pode ser emitido durante uma corrida em andamento.');
        return;
      }

      if (!confirm('🚨 ALERTA DE EMERGÊNCIA HUBy!\nDeseja acionar a central de segurança da plataforma agora?')) {
        return;
      }

      const token = localStorage.getItem('huby_token');
      const lat = estado.hubyMapa?.coordsOrigem ? estado.hubyMapa.coordsOrigem[0] : null;
      const lng = estado.hubyMapa?.coordsOrigem ? estado.hubyMapa.coordsOrigem[1] : null;

      try {
        const resp = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/sos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            lat,
            lng,
            relato: 'SOS emitido pelo motorista parceiro durante a corrida.'
          })
        });

        if (resp.ok) {
          alert('🚨 SOS REGISTRADO!\nA central de suporte do Admin Master foi notificada com sua posição GPS.');
        }
      } catch (err) {
        alert('Falha ao acionar socorro via rede. Contate a polícia imediatamente (190).');
      }
    }
  });
}

function configurarFiltroDirecaoCasa() {
  const btnCasa = document.getElementById('btnFiltroCasa');
  if (!btnCasa) return;

  btnCasa.addEventListener('click', async () => {
    const token = localStorage.getItem('huby_token');

    if (!estado.direcaoCasaAtiva) {
      const enderecoCasa = prompt('Insira o endereço ou ponto de referência de sua residência:');
      if (!enderecoCasa) return;

      const latCasa = estado.hubyMapa?.coordsOrigem ? estado.hubyMapa.coordsOrigem[0] : -8.3580;
      const lngCasa = estado.hubyMapa?.coordsOrigem ? estado.hubyMapa.coordsOrigem[1] : -42.2460;
      estado.coordsCasaMotorista = { lat: latCasa, lng: lngCasa };

      try {
        const resp = await fetch(`${API_URL}/api/motoristas/filtro-destino`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ativo: true,
            lat: estado.coordsCasaMotorista.lat,
            lng: estado.coordsCasaMotorista.lng
          })
        });

        if (resp.ok) {
          estado.direcaoCasaAtiva = true;
          btnCasa.style.background = '#F59E0B';
          btnCasa.style.color = '#000';
          btnCasa.textContent = '🏠 Rumo a Casa (Ativo)';
          alert('Filtro ativado! Você receberá chamadas com rota direcionada à sua casa.');
        }
      } catch (err) {
        alert('Erro ao ativar filtro.');
      }
    } else {
      try {
        await fetch(`${API_URL}/api/motoristas/filtro-destino`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ ativo: false })
        });
        estado.direcaoCasaAtiva = false;
        btnCasa.style.background = '';
        btnCasa.style.color = '';
        btnCasa.textContent = '🏠 Direção de Casa';
        alert('Filtro desativado. Modo normal restaurado.');
      } catch (err) {
        alert('Erro ao desativar filtro.');
      }
    }
  });
}

function configurarModalIncidentes() {
  const btnReportar = document.getElementById('btnAbrirModalIncidente');
  const modal = document.getElementById('modalReportarIncidente');
  const btnFechar = document.getElementById('btnFecharModalIncidente');
  const btnEnviar = document.getElementById('btnEnviarIncidente');

  btnReportar?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });

  btnEnviar?.addEventListener('click', async () => {
    const tipo = document.getElementById('selectTipoIncidente')?.value;
    const relato = document.getElementById('txtDescricaoIncidente')?.value.trim();
    const token = localStorage.getItem('huby_token');

    if (!relato) {
      alert('Por favor, descreva o ocorrido com detalhes.');
      return;
    }

    try {
      btnEnviar.disabled = true;
      btnEnviar.textContent = 'Enviando...';

      const resp = await fetch(`${API_URL}/api/pedidos/incidentes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          tipo_alerta: tipo,
          descricao: relato,
          pedido_id: estado.pedidoAceitoAtual?.id || null
        })
      });

      if (resp.ok) {
        alert('Incidente reportado com sucesso! A equipa de suporte analisará o caso.');
        if (modal) modal.style.display = 'none';
        const txt = document.getElementById('txtDescricaoIncidente');
        if (txt) txt.value = '';
      } else {
        alert('Não foi possível enviar o relato no momento.');
      }
    } catch (err) {
      alert('Falha de conexão.');
    } finally {
      btnEnviar.disabled = false;
      btnEnviar.textContent = 'Enviar Relato';
    }
  });
}