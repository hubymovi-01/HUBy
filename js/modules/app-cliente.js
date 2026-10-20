// ./js/modules/app-cliente.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim (fallback inicial)
  let clienteCoords = [...defaultCoords];
  let pontoDestinoCoords = null;

  // 1. INICIALIZAR O MAPA SEM BOTÕES DE ZOOM E SEM CRÉDITOS DO LEAFLET
  const mapElement = document.getElementById('mapaCliente');
  let map = null;
  let markerCliente = null;
  let markerDestino = null;

  if (mapElement) {
    map = L.map('mapaCliente', {
      zoomControl: false,
      attributionControl: false
    }).setView(defaultCoords, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    markerCliente = L.circleMarker(defaultCoords, {
      radius: 9,
      color: '#10B981',
      fillColor: '#10B981',
      fillOpacity: 1
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 300);
    window.addEventListener('resize', () => map.invalidateSize());

    // Obter GPS real do utilizador se autorizado
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clienteCoords = [pos.coords.latitude, pos.coords.longitude];
          markerCliente.setLatLng(clienteCoords);
          map.setView(clienteCoords, 15, { animate: true });
          map.invalidateSize();
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    // Clique no mapa para definir destino
    map.on('click', (e) => {
      pontoDestinoCoords = [e.latlng.lat, e.latlng.lng];
      if (markerDestino) {
        markerDestino.setLatLng(pontoDestinoCoords);
      } else {
        markerDestino = L.marker(pontoDestinoCoords).addTo(map);
      }
      const inputDestino = document.getElementById('inputDestino');
      if (inputDestino) {
        inputDestino.value = `Ponto selecionado no mapa (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`;
      }
      recalcularValores();
    });
  }

  // Botão Meu GPS
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    if (map) {
      map.setView(clienteCoords, 16, { animate: true });
      map.invalidateSize();
    }
  });

  // 2. CONTROLO DO ONBOARDING / ENTRADA (SPLASH SCREEN)
  const splash = document.getElementById('splashScreen');
  const btnEntrar = document.getElementById('btnEntrarApp');

  btnEntrar?.addEventListener('click', () => {
    if (splash) {
      splash.classList.add('fechado');
      splash.style.display = 'none';
    }
    setTimeout(() => map?.invalidateSize(), 200);
  });

  // 3. SELEÇÃO DE MODALIDADES E SUB-VEÍCULOS
  let grupoSelecionado = 'carro';
  let subVeiculoSelecionado = 'HUBy Carro';
  let precoBase = 16.10;
  let qtdAjudantes = 0;
  let temEscada = false;
  let temParadaExtra = false;

  const configVeiculos = {
    carro: [
      { id: 'carro', label: '🚗 HUBy Carro', base: 16.10 },
      { id: 'moto', label: '🛵 HUBy Moto', base: 9.50 }
    ],
    flash: [
      { id: 'flash_moto', label: '⚡ Flash Moto', base: 8.90 },
      { id: 'flash_carro', label: '📦 Flash Utilitário', base: 19.00 }
    ],
    cargo: [
      { id: 'cargo_pickup', label: '🛻 Caminhonete/Picape', base: 55.00 },
      { id: 'cargo_van', label: '🚐 Van de Carga', base: 85.00 },
      { id: 'cargo_vuc', label: '🚚 Caminhão Pequeno (VUC)', base: 140.00 }
    ]
  };

  const containerSub = document.getElementById('containerSubVeiculos');
  const linhaAjudante = document.getElementById('linhaAjudante');
  const linhaEscada = document.getElementById('linhaEscada');

  function renderizarSubVeiculos() {
    if (!containerSub) return;
    const lista = configVeiculos[grupoSelecionado] || [];
    containerSub.innerHTML = lista.map((v, i) => `
      <button type="button" class="sub-pill ${i === 0 ? 'active' : ''}" data-id="${v.id}" data-base="${v.base}" data-label="${v.label}">
        ${v.label}
      </button>
    `).join('');

    subVeiculoSelecionado = lista[0]?.label || 'HUBy Carro';
    precoBase = lista[0]?.base || 16.10;

    containerSub.querySelectorAll('.sub-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        containerSub.querySelectorAll('.sub-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        subVeiculoSelecionado = btn.getAttribute('data-label');
        precoBase = parseFloat(btn.getAttribute('data-base')) || 16.10;
        recalcularValores();
      });
    });

    if (grupoSelecionado === 'cargo') {
      if (linhaAjudante) linhaAjudante.style.display = 'flex';
      if (linhaEscada) linhaEscada.style.display = 'flex';
    } else {
      if (linhaAjudante) linhaAjudante.style.display = 'none';
      if (linhaEscada) linhaEscada.style.display = 'none';
    }

    recalcularValores();
  }

  document.querySelectorAll('.tab-card').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-card').forEach(t => t.className = 'tab-card');
      const g = tab.getAttribute('data-grupo');
      tab.classList.add(`active-${g}`);
      grupoSelecionado = g;
      renderizarSubVeiculos();
    });
  });

  renderizarSubVeiculos();

  // 4. ADICIONAIS E CÁLCULO
  const txtQtdAjudantes = document.getElementById('txtQtdAjudantes');
  document.getElementById('btnMenosAjudante')?.addEventListener('click', () => {
    if (qtdAjudantes > 0) {
      qtdAjudantes--;
      if (txtQtdAjudantes) txtQtdAjudantes.textContent = qtdAjudantes;
      recalcularValores();
    }
  });

  document.getElementById('btnMaisAjudante')?.addEventListener('click', () => {
    if (qtdAjudantes < 4) {
      qtdAjudantes++;
      if (txtQtdAjudantes) txtQtdAjudantes.textContent = qtdAjudantes;
      recalcularValores();
    }
  });

  document.getElementById('chkEscada')?.addEventListener('change', (e) => {
    temEscada = e.target.checked;
    recalcularValores();
  });

  document.getElementById('chkParadaExtra')?.addEventListener('change', (e) => {
    temParadaExtra = e.target.checked;
    recalcularValores();
  });

  function recalcularValores() {
    let adicionais = 0;
    if (grupoSelecionado === 'cargo') {
      adicionais += (qtdAjudantes * 50);
      if (temEscada) adicionais += 20;
    }
    if (temParadaExtra) adicionais += 6;

    const totalFinal = precoBase + adicionais;

    const txtValorAdicionais = document.getElementById('txtValorAdicionais');
    if (txtValorAdicionais) txtValorAdicionais.textContent = `R$ ${adicionais.toFixed(2).replace('.', ',')}`;

    const txtPrecoFinal = document.getElementById('txtPrecoFinal');
    if (txtPrecoFinal) txtPrecoFinal.textContent = `R$ ${totalFinal.toFixed(2).replace('.', ',')}`;

    const txtBotaoAcao = document.getElementById('txtBotaoAcao');
    if (txtBotaoAcao) txtBotaoAcao.textContent = `Chamar ${subVeiculoSelecionado}`;
  }

  // 5. ENVIAR PEDIDO AO RENDER/NEON
  const btnSolicitar = document.getElementById('btnSolicitarHuby');
  const bannerStatus = document.getElementById('bannerStatusCorrida');

  btnSolicitar?.addEventListener('click', async () => {
    const inputDestino = document.getElementById('inputDestino');
    const destinoTexto = inputDestino?.value.trim() || 'Ponto selecionado no mapa (1.0 km)';
    const metodoPgto = document.getElementById('selectMetodoPgto')?.value || 'pix_app';
    const precoTexto = document.getElementById('txtPrecoFinal')?.textContent || 'R$ 16,10';

    // Se o cliente não tiver clicado no mapa, cria um ponto de destino a ~900m
    const destinoFinalCoords = pontoDestinoCoords || [
      clienteCoords[0] + 0.007,
      clienteCoords[1] + 0.007
    ];

    const novoPedido = {
      id: Math.random().toString(36).substring(2, 7).toUpperCase(),
      tipo: grupoSelecionado,
      subTipoLabel: subVeiculoSelecionado,
      origem: 'GPS: Localização exata ativa',
      destino: destinoTexto,
      coordsOrigem: clienteCoords,
      coordsDestino: destinoFinalCoords,
      distancia: '1.0 km',
      preco: precoTexto,
      metodoPgto: metodoPgto,
      criadoEm: new Date().toISOString()
    };

    if (bannerStatus) {
      bannerStatus.className = 'status-banner ativo';
      bannerStatus.innerHTML = `⏳ A enviar solicitação #${novoPedido.id}...`;
    }

    // Grava localmente de imediato
    const pedidosAtuais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosAtuais.unshift(novoPedido);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosAtuais));

    // Notifica o canal do motorista
    try {
      const channel = new BroadcastChannel('huby_orders_channel');
      channel.postMessage({ tipo: 'NOVO_PEDIDO', pedido: novoPedido });
    } catch (e) {}

    // Envia para o Render / Neon
    try {
      await fetch(`${API_URL}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novoPedido)
      });
    } catch (err) {
      console.warn('Erro ao ligar ao servidor Render, mantido localmente.', err);
    }

    if (bannerStatus) {
      bannerStatus.innerHTML = `✅ Pedido <strong>#${novoPedido.id}</strong> enviado com sucesso!<br><small>A aguardar motorista parceiro HUBy...</small>`;
    }
  });

  // 6. NAVEGAÇÃO ENTRE AS ABAS INFERIORES
  const botoesNav = document.querySelectorAll('.nav-item');
  const telas = document.querySelectorAll('.tab-view');

  botoesNav.forEach(btn => {
    btn.addEventListener('click', () => {
      botoesNav.forEach(b => b.classList.remove('active'));
      telas.forEach(t => t.classList.remove('active-view'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active-view');

      if (targetId === 'viewInicio') {
        setTimeout(() => map?.invalidateSize(), 200);
      }
    });
  });
});