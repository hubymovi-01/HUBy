// ./js/modules/app-cliente.js

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inicialização do Mapa Leaflet
  const mapElement = document.getElementById('mapaCliente');
  if (!mapElement) return;

  // Centro padrão inicial (Piauí / Brasil)
  const defaultCoords = [-7.7735, -42.2472];
  const map = L.map('mapaCliente', {
    zoomControl: false
  }).setView(defaultCoords, 14);

  // Botões de zoom reposicionados
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Camada Dark Mode sem marca d'água / sem exigência de API Key paga
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  // Marcadores de rota
  let marcadorOrigem = null;
  let marcadorDestino = null;
  let linhaRota = null;

  let rotaAtual = {
    distanciaKm: 3.5,
    duracaoMin: 8,
    grupo: 'carro',
    subTipo: 'carro',
    ajudantes: 0,
    escada: false,
    paradaExtra: false
  };

  // 2. Configurações de Tarifas
  const subCategorias = {
    carro: [
      { id: 'carro', label: '🚗 HUBy Carro', base: 6.0, km: 2.2, min: 0.3 },
      { id: 'moto', label: '🏍️ HUBy Moto', base: 4.0, km: 1.4, min: 0.2 }
    ],
    flash: [
      { id: 'flash_moto', label: '🛵 Flash Moto', base: 4.5, km: 1.5, min: 0.25 },
      { id: 'flash_carro', label: '🚗 Flash Carro', base: 7.0, km: 2.3, min: 0.35 }
    ],
    cargo: [
      { id: 'cargo_vuc', label: '🚚 HUBy Cargo (VUC / Caminhão)', base: 80.0, km: 6.5, min: 0.8 }
    ]
  };

  // Elementos da Interface
  const containerSubVeiculos = document.getElementById('containerSubVeiculos');
  const linhaAjudante = document.getElementById('linhaAjudante');
  const linhaEscada = document.getElementById('linhaEscada');
  const chkEscada = document.getElementById('chkEscada');
  const chkParadaExtra = document.getElementById('chkParadaExtra');
  const txtQtdAjudantes = document.getElementById('txtQtdAjudantes');
  const txtDistKm = document.getElementById('txtDistKm');
  const txtDuracaoMin = document.getElementById('txtDuracaoMin');
  const txtValorAdicionais = document.getElementById('txtValorAdicionais');
  const txtPrecoFinal = document.getElementById('txtPrecoFinal');
  const txtBotaoAcao = document.getElementById('txtBotaoAcao');
  const bannerStatus = document.getElementById('bannerStatusCorrida');
  const btnSolicitarHuby = document.getElementById('btnSolicitarHuby');

  // 3. Renderização de Subcategorias
  function renderSubCategorias() {
    containerSubVeiculos.innerHTML = '';
    const lista = subCategorias[rotaAtual.grupo] || [];

    lista.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn-sub-veiculo ${index === 0 ? 'active' : ''}`;
      btn.textContent = item.label;
      btn.style.cssText = `
        padding: 8px 14px;
        background: ${index === 0 ? '#10B981' : '#1E293B'};
        color: #FFFFFF;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: 0.2s;
      `;

      btn.addEventListener('click', () => {
        containerSubVeiculos.querySelectorAll('button').forEach(b => {
          b.style.background = '#1E293B';
        });
        btn.style.background = '#10B981';
        rotaAtual.subTipo = item.id;
        atualizarCalculos();
      });

      containerSubVeiculos.appendChild(btn);
    });

    rotaAtual.subTipo = lista[0]?.id || 'carro';
  }

  // 4. Alternância dos Grupos Principais
  document.querySelectorAll('.tab-card').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-card').forEach(t => t.classList.remove('active-carro'));
      tab.classList.add('active-carro');

      rotaAtual.grupo = tab.getAttribute('data-grupo');

      if (rotaAtual.grupo === 'cargo') {
        linhaAjudante.style.display = 'flex';
        linhaEscada.style.display = 'flex';
      } else {
        linhaAjudante.style.display = 'none';
        linhaEscada.style.display = 'none';
        rotaAtual.ajudantes = 0;
        txtQtdAjudantes.textContent = '0';
        chkEscada.checked = false;
        rotaAtual.escada = false;
      }

      renderSubCategorias();
      atualizarCalculos();
    });
  });

  // 5. Controles de Adicionais
  document.getElementById('btnMaisAjudante')?.addEventListener('click', () => {
    rotaAtual.ajudantes++;
    txtQtdAjudantes.textContent = rotaAtual.ajudantes;
    atualizarCalculos();
  });

  document.getElementById('btnMenosAjudante')?.addEventListener('click', () => {
    if (rotaAtual.ajudantes > 0) {
      rotaAtual.ajudantes--;
      txtQtdAjudantes.textContent = rotaAtual.ajudantes;
      atualizarCalculos();
    }
  });

  chkEscada?.addEventListener('change', (e) => {
    rotaAtual.escada = e.target.checked;
    atualizarCalculos();
  });

  chkParadaExtra?.addEventListener('change', (e) => {
    rotaAtual.paradaExtra = e.target.checked;
    atualizarCalculos();
  });

  // 6. Cálculo em Tempo Real
  function atualizarCalculos() {
    let tarifa = null;
    const lista = subCategorias[rotaAtual.grupo] || [];
    tarifa = lista.find(s => s.id === rotaAtual.subTipo) || lista[0];

    const km = rotaAtual.distanciaKm;
    const min = rotaAtual.duracaoMin;

    let valorBase = tarifa.base + (km * tarifa.km) + (min * tarifa.min);

    let adicionais = 0;
    if (rotaAtual.ajudantes > 0) adicionais += (rotaAtual.ajudantes * 50);
    if (rotaAtual.escada) adicionais += 20;
    if (rotaAtual.paradaExtra) adicionais += 6;

    const total = valorBase + adicionais;

    txtDistKm.textContent = `${km.toFixed(1)} km`;
    txtDuracaoMin.textContent = `${min}`;
    txtValorAdicionais.textContent = `R$ ${adicionais.toFixed(2).replace('.', ',')}`;
    txtPrecoFinal.textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
    txtBotaoAcao.textContent = `Chamar ${tarifa.label.replace(/^[^\s]+ /, '')}`;
  }

  // 7. Geolocalização (GPS)
  const btnLocalizarGPS = document.getElementById('btnLocalizarGPS');
  btnLocalizarGPS?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada pelo seu navegador.');
      return;
    }

    btnLocalizarGPS.textContent = 'Buscando...';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const coords = [latitude, longitude];

        map.setView(coords, 16);

        if (!marcadorOrigem) {
          marcadorOrigem = L.circleMarker(coords, {
            radius: 8,
            color: '#10B981',
            fillColor: '#10B981',
            fillOpacity: 1
          }).addTo(map);
        } else {
          marcadorOrigem.setLatLng(coords);
        }

        btnLocalizarGPS.textContent = '📍 Meu GPS';
        document.getElementById('inputOrigem').value = 'GPS: Localização exata ativa';
      },
      () => {
        alert('Não foi possível obter o sinal de GPS.');
        btnLocalizarGPS.textContent = '📍 Meu GPS';
      },
      { enableHighAccuracy: true }
    );
  });

  // 8. Clique no Mapa para Definir Destino
  map.on('click', (e) => {
    const coords = e.latlng;

    if (!marcadorDestino) {
      marcadorDestino = L.marker(coords).addTo(map);
    } else {
      marcadorDestino.setLatLng(coords);
    }

    document.getElementById('inputDestino').value = 'Ponto selecionado no mapa';

    const origem = marcadorOrigem ? marcadorOrigem.getLatLng() : L.latLng(defaultCoords);
    const distanciaMetros = map.distance(origem, coords);
    
    rotaAtual.distanciaKm = Math.max(1, distanciaMetros / 1000);
    rotaAtual.duracaoMin = Math.round(rotaAtual.distanciaKm * 2.2);

    if (linhaRota) map.removeLayer(linhaRota);
    linhaRota = L.polyline([origem, coords], {
      color: '#10B981',
      weight: 4,
      dashArray: '8, 8'
    }).addTo(map);

    atualizarCalculos();
  });

  // 9. Envio do Pedido
  btnSolicitarHuby?.addEventListener('click', () => {
    const idPedido = Math.random().toString(36).substring(2, 7);
    bannerStatus.style.display = 'block';
    bannerStatus.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10B981; border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 13px; text-align: center;">
        ✅ Pedido <strong>#${idPedido}</strong> enviado!<br>
        A procurar motorista parceiro HUBy...
      </div>
    `;

    setTimeout(() => {
      bannerStatus.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  });

  // Inicialização inicial dos dados
  renderSubCategorias();
  atualizarCalculos();
});