// ./js/modules/app-cliente.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const defaultCoords = [-8.3565, -42.2504]; // Paes Landim (fallback inicial)
  let clienteCoords = [...defaultCoords];
  let pontoDestinoCoords = null;
  let linhaTracaoRota = null;
  
  // Declaração antecipada das variáveis de estado para evitar erros
  let distanciaKmGlobal = 1.5;
  let grupoSelecionado = 'carro';
  let subVeiculoSelecionado = 'HUBy Carro';
  let baseTarifa = 7.00;
  let valorPorKm = 2.60;
  let qtdAjudantes = 0;
  let temEscada = false;
  let temParadaExtra = false;

  // 1. INICIALIZAR O MAPA DO PASSAGEIRO
  const mapElement = document.getElementById('mapaCliente');
  let map = null;
  let markerCliente = null;
  let markerDestino = null;

  if (mapElement) {
    map = L.map('mapaCliente', {
      zoomControl: false,
      attributionControl: false
    }).setView(defaultCoords, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    markerCliente = L.circleMarker(defaultCoords, {
      radius: 9,
      color: '#10B981',
      fillColor: '#10B981',
      fillOpacity: 1,
      weight: 3
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 300);
    window.addEventListener('resize', () => map.invalidateSize());

    // Obter GPS real do passageiro
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clienteCoords = [pos.coords.latitude, pos.coords.longitude];
          markerCliente.setLatLng(clienteCoords);
          map.setView(clienteCoords, 16, { animate: true });
          map.invalidateSize();
          recalcularValores();
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    // Clique no mapa para definir destino
    map.on('click', (e) => {
      definirDestinoNoMapa(
        e.latlng.lat,
        e.latlng.lng,
        `Ponto selecionado (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`
      );
    });
  }

  function definirDestinoNoMapa(lat, lng, textoExibicao = '') {
    pontoDestinoCoords = [lat, lng];

    if (markerDestino) {
      markerDestino.setLatLng(pontoDestinoCoords);
    } else {
      markerDestino = L.marker(pontoDestinoCoords).addTo(map);
    }

    const inputDestino = document.getElementById('inputDestino');
    if (inputDestino && textoExibicao) {
      inputDestino.value = textoExibicao;
    }

    // Traça linha visual do trajeto entre passageiro e destino
    if (linhaTracaoRota) map.removeLayer(linhaTracaoRota);
    linhaTracaoRota = L.polyline([clienteCoords, pontoDestinoCoords], {
      color: '#10B981',
      weight: 4,
      dashArray: '6, 8',
      opacity: 0.85
    }).addTo(map);

    // Ajusta a câmara para mostrar os dois pontos
    if (map) {
      const bounds = L.latLngBounds([clienteCoords, pontoDestinoCoords]);
      map.fitBounds(bounds, { padding: [70, 70], animate: true });
    }

    recalcularValores();
  }

  // 2. BUSCA DE ENDEREÇO VIA NOMINATIM
  const btnBuscarEndereco = document.getElementById('btnBuscarEndereco');
  const inputDestino = document.getElementById('inputDestino');

  async function executarBuscaDestino() {
    const texto = inputDestino?.value.trim();
    if (!texto) {
      alert('Digite o nome de uma rua, bairro ou local.');
      return;
    }

    if (btnBuscarEndereco) {
      btnBuscarEndereco.textContent = '⏳';
      btnBuscarEndereco.disabled = true;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=br&limit=1`;
      const resposta = await fetch(url, {
        headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' }
      });
      const dados = await resposta.json();

      if (dados && dados.length > 0) {
        const resultado = dados[0];
        const lat = parseFloat(resultado.lat);
        const lon = parseFloat(resultado.lon);
        definirDestinoNoMapa(lat, lon, resultado.display_name.split(',')[0]);
      } else {
        alert('Endereço não localizado. Toque diretamente no mapa.');
      }
    } catch (err) {
      console.warn('Erro ao pesquisar:', err);
    } finally {
      if (btnBuscarEndereco) {
        btnBuscarEndereco.textContent = 'Ir';
        btnBuscarEndereco.disabled = false;
      }
    }
  }

  btnBuscarEndereco?.addEventListener('click', executarBuscaDestino);
  inputDestino?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executarBuscaDestino();
    }
  });

  // Botão Meu GPS
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    if (map) {
      map.setView(clienteCoords, 16, { animate: true });
      map.invalidateSize();
    }
  });

  // 3. TELA DE ENTRADA
  const splash = document.getElementById('splashScreen');
  const btnEntrar = document.getElementById('btnEntrarApp');
  btnEntrar?.addEventListener('click', () => {
    if (splash) {
      splash.classList.add('fechado');
      splash.style.display = 'none';
    }
    setTimeout(() => map?.invalidateSize(), 200);
  });

  // 4. CONFIGURAÇÃO DE TARIFAS POR QUILÓMETRO
  const configVeiculos = {
    carro: [
      { id: 'carro', label: '🚗 HUBy Carro', base: 7.00, porKm: 2.60 },
      { id: 'moto', label: '🛵 HUBy Moto', base: 4.50, porKm: 1.40 }
    ],
    flash: [
      { id: 'flash_moto', label: '⚡ Flash Moto', base: 5.00, porKm: 1.50 },
      { id: 'flash_carro', label: '📦 Flash Utilitário', base: 9.00, porKm: 2.80 }
    ],
    cargo: [
      { id: 'cargo_pickup', label: '🛻 Caminhonete/Picape', base: 35.00, porKm: 5.00 },
      { id: 'cargo_van', label: '🚐 Van de Carga', base: 50.00, porKm: 7.00 },
      { id: 'cargo_vuc', label: '🚚 Caminhão Pequeno (VUC)', base: 80.00, porKm: 10.00 }
    ]
  };

  const containerSub = document.getElementById('containerSubVeiculos');
  const linhaAjudante = document.getElementById('linhaAjudante');
  const linhaEscada = document.getElementById('linhaEscada');

  function renderizarSubVeiculos() {
    if (!containerSub) return;
    const lista = configVeiculos[grupoSelecionado] || [];
    containerSub.innerHTML = lista.map((v, i) => `
      <button type="button" class="sub-pill ${i === 0 ? 'active' : ''}" data-id="${v.id}" data-base="${v.base}" data-porkm="${v.porKm}" data-label="${v.label}">
        ${v.label}
      </button>
    `).join('');

    subVeiculoSelecionado = lista[0]?.label || 'HUBy Carro';
    baseTarifa = lista[0]?.base || 7.00;
    valorPorKm = lista[0]?.porKm || 2.60;

    containerSub.querySelectorAll('.sub-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        containerSub.querySelectorAll('.sub-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        subVeiculoSelecionado = btn.getAttribute('data-label');
        baseTarifa = parseFloat(btn.getAttribute('data-base')) || 7.00;
        valorPorKm = parseFloat(btn.getAttribute('data-porkm')) || 2.60;
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

  // Adicionais
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

  // 5. FUNÇÃO DE CÁLCULO DE DISTÂNCIA E PREÇO DINÂMICO
  function recalcularValores() {
    if (pontoDestinoCoords && map) {
      const metros = map.distance(L.latLng(clienteCoords), L.latLng(pontoDestinoCoords));
      distanciaKmGlobal = Math.max(0.5, metros / 1000);
    } else {
      distanciaKmGlobal = 1.5;
    }

    const minutosEstimados = Math.max(3, Math.round(distanciaKmGlobal * 2.5 + 2));

    let adicionais = 0;
    if (grupoSelecionado === 'cargo') {
      adicionais += (qtdAjudantes * 50);
      if (temEscada) adicionais += 20;
    }
    if (temParadaExtra) adicionais += 6;

    const valorCorrida = baseTarifa + (distanciaKmGlobal * valorPorKm) + adicionais;

    const txtDistKm = document.getElementById('txtDistKm');
    if (txtDistKm) txtDistKm.textContent = `${distanciaKmGlobal.toFixed(1)} km`;

    const txtDuracaoMin = document.getElementById('txtDuracaoMin');
    if (txtDuracaoMin) txtDuracaoMin.textContent = minutosEstimados;

    const txtValorAdicionais = document.getElementById('txtValorAdicionais');
    if (txtValorAdicionais) txtValorAdicionais.textContent = `R$ ${adicionais.toFixed(2).replace('.', ',')}`;

    const txtPrecoFinal = document.getElementById('txtPrecoFinal');
    if (txtPrecoFinal) txtPrecoFinal.textContent = `R$ ${valorCorrida.toFixed(2).replace('.', ',')}`;

    const txtBotaoAcao = document.getElementById('txtBotaoAcao');
    if (txtBotaoAcao) txtBotaoAcao.textContent = `Chamar ${subVeiculoSelecionado}`;
  }

  // Executa o cálculo inicial
  recalcularValores();

  // 6. ENVIAR PEDIDO AO RENDER/NEON
  const btnSolicitar = document.getElementById('btnSolicitarHuby');
  const bannerStatus = document.getElementById('bannerStatusCorrida');
  let bannerTimer = null;

  btnSolicitar?.addEventListener('click', async () => {
    const destinoTexto = inputDestino?.value.trim() || 'Ponto selecionado no mapa';
    const metodoPgto = document.getElementById('selectMetodoPgto')?.value || 'pix_app';
    const precoTexto = document.getElementById('txtPrecoFinal')?.textContent || 'R$ 10,00';

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
      distancia: `${distanciaKmGlobal.toFixed(1)} km`,
      preco: precoTexto,
      metodoPgto: metodoPgto,
      criadoEm: new Date().toISOString()
    };

    if (bannerStatus) {
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerStatus.className = 'status-banner ativo';
      bannerStatus.style.display = 'block';
      bannerStatus.innerHTML = `⏳ A enviar solicitação #${novoPedido.id}...`;
    }

    const pedidosAtuais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosAtuais.unshift(novoPedido);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosAtuais));

    try {
      const channel = new BroadcastChannel('huby_orders_channel');
      channel.postMessage({ tipo: 'NOVO_PEDIDO', pedido: novoPedido });
    } catch (e) {}

    try {
      await fetch(`${API_URL}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novoPedido)
      });
    } catch (err) {
      console.warn('Erro ao comunicar com o servidor Render, mantido localmente.', err);
    }

    if (bannerStatus) {
      bannerStatus.innerHTML = `✅ Pedido <strong>#${novoPedido.id}</strong> enviado com sucesso!<br><small>A aguardar motorista parceiro HUBy...</small>`;
      bannerTimer = setTimeout(() => {
        bannerStatus.classList.remove('ativo');
        bannerStatus.style.display = 'none';
      }, 5000);
    }
  });

  // 7. NAVEGAÇÃO ENTRE AS ABAS
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