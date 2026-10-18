// ./js/modules/app-cliente.js

document.addEventListener('DOMContentLoaded', () => {
  // 0. Gestão da Tela de Entrada (Splash Screen / Onboarding)
  const splash = document.getElementById('splashScreen');
  const btnEntrar = document.getElementById('btnEntrarApp');

  btnEntrar?.addEventListener('click', () => {
    splash?.classList.add('fechado');
    if (window.hubyMap) {
      setTimeout(() => window.hubyMap.invalidateSize(), 300);
    }
  });

  // Rotação dos slides na tela de entrada
  const pillarCards = document.querySelectorAll('.pillar-card');
  const dots = document.querySelectorAll('.slide-dots .dot');
  let currentPillar = 0;

  if (pillarCards.length > 0) {
    setInterval(() => {
      currentPillar = (currentPillar + 1) % pillarCards.length;
      pillarCards.forEach((card, idx) => {
        card.classList.toggle('active', idx === currentPillar);
      });
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentPillar);
      });
    }, 3500);
  }

  // 1. Alternância de Abas na Barra Inferior
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  function trocarAba(targetId) {
    tabViews.forEach(v => v.classList.remove('active-view'));
    navItems.forEach(n => n.classList.remove('active'));

    const activeView = document.getElementById(targetId);
    if (activeView) activeView.classList.add('active-view');

    const activeNav = document.querySelector(`.bottom-nav .nav-item[data-tab="${targetId}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (targetId === 'viewInicio' && window.hubyMap) {
      setTimeout(() => window.hubyMap.invalidateSize(), 150);
    }
  }

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');
      trocarAba(tabTarget);
    });
  });

  // Atalho nos cards de serviços para abrir o fluxo de chamada no início
  document.querySelectorAll('.action-solicitar').forEach(card => {
    card.addEventListener('click', () => {
      const grupo = card.getAttribute('data-target-group');
      trocarAba('viewInicio');
      
      const tabGroup = document.querySelector(`.tab-card[data-grupo="${grupo}"]`);
      if (tabGroup) tabGroup.click();
    });
  });

  document.getElementById('btnIrCarteira')?.addEventListener('click', () => {
    trocarAba('viewConta');
  });

  // 2. Inicialização do Mapa Leaflet com OpenStreetMap (Dark Filter)
  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim - PI
  const map = L.map('mapaCliente', {
    zoomControl: false
  }).setView(defaultCoords, 14);

  window.hubyMap = map;

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

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

  const coresModalidade = {
    carro: { cor: '#10B981', text: '#042F2E', glow: 'rgba(16, 185, 129, 0.25)' },
    flash: { cor: '#0EA5E9', text: '#082F49', glow: 'rgba(14, 165, 233, 0.25)' },
    cargo: { cor: '#F97316', text: '#431407', glow: 'rgba(249, 115, 22, 0.25)' }
  };

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
  const btnSolicitarHuby = document.getElementById('btnSolicitarHuby');
  const bannerStatus = document.getElementById('bannerStatusCorrida');

  function renderSubCategorias() {
    containerSubVeiculos.innerHTML = '';
    const lista = subCategorias[rotaAtual.grupo] || [];
    const tema = coresModalidade[rotaAtual.grupo];

    lista.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn-sub-veiculo ${index === 0 ? 'active' : ''}`;
      btn.textContent = item.label;
      btn.style.cssText = `
        padding: 8px 14px;
        background: ${index === 0 ? tema.cor : 'rgba(255, 255, 255, 0.05)'};
        color: ${index === 0 ? tema.text : '#FFFFFF'};
        border: 1px solid var(--border-subtle);
        border-radius: 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s ease;
      `;

      btn.addEventListener('click', () => {
        containerSubVeiculos.querySelectorAll('button').forEach(b => {
          b.style.background = 'rgba(255, 255, 255, 0.05)';
          b.style.color = '#FFFFFF';
        });
        btn.style.background = tema.cor;
        btn.style.color = tema.text;
        rotaAtual.subTipo = item.id;
        atualizarCalculos();
      });

      containerSubVeiculos.appendChild(btn);
    });

    rotaAtual.subTipo = lista[0]?.id || 'carro';
  }

  // 3. Alternância dos Grupos Principais
  document.querySelectorAll('.tab-card').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-card').forEach(t => {
        t.classList.remove('active-carro', 'active-flash', 'active-cargo');
      });

      rotaAtual.grupo = tab.getAttribute('data-grupo');
      tab.classList.add(`active-${rotaAtual.grupo}`);

      const tema = coresModalidade[rotaAtual.grupo];
      btnSolicitarHuby.style.background = tema.cor;
      btnSolicitarHuby.style.color = tema.text;
      btnSolicitarHuby.style.boxShadow = `0 8px 24px ${tema.glow}`;

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

  // 4. Controles de Adicionais
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

  // 5. Cálculo Dinâmico de Valores
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

  // 6. Geolocalização (GPS)
  const btnLocalizarGPS = document.getElementById('btnLocalizarGPS');
  btnLocalizarGPS?.addEventListener('click', () => {
    if (!navigator.geolocation) return;
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

  // 7. Clique no Mapa para Seleção de Destino
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
      color: coresModalidade[rotaAtual.grupo].cor,
      weight: 4,
      dashArray: '8, 8'
    }).addTo(map);

    atualizarCalculos();
  });

  // 8. Solicitar Corrida
  btnSolicitarHuby?.addEventListener('click', () => {
    const idPedido = Math.random().toString(36).substring(2, 7);
    bannerStatus.style.display = 'block';
    bannerStatus.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10B981; border-radius: 12px; padding: 12px; margin-bottom: 12px; font-size: 13px; text-align: center;">
        ✅ Pedido <strong>#${idPedido}</strong> enviado!<br>
        A procurar motorista parceiro HUBy...
      </div>
    `;

    setTimeout(() => {
      bannerStatus.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  });

  renderSubCategorias();
  atualizarCalculos();
});