// ./js/modules/app-cliente.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const defaultCoords = [-8.3580, -41.8950]; // Ponto de partida inicial
  let clienteCoords = [...defaultCoords];
  let pontoDestinoCoords = null;
  let linhaTracaoRota = null;
  let gpsObtido = false;
  
  // Declaração das variáveis de estado
  let distanciaKmGlobal = 1.5;
  let grupoSelecionado = 'carro';
  let subVeiculoSelecionado = 'HUBy Carro';
  let baseTarifa = 7.00;
  let valorPorKm = 2.60;
  let qtdAjudantes = 0;
  let temEscada = false;
  let temParadaExtra = false;

  // SISTEMA DE NOTIFICAÇÃO TOAST VISUAL
  function mostrarToast(mensagem, tipo = 'alerta') {
    let toast = document.getElementById('hubyToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'hubyToast';
      toast.style.position = 'fixed';
      toast.style.top = '22px';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      toast.style.padding = '12px 20px';
      toast.style.borderRadius = '14px';
      toast.style.fontSize = '12px';
      toast.style.fontWeight = '800';
      toast.style.letterSpacing = '0.3px';
      toast.style.zIndex = '999999';
      toast.style.boxShadow = '0 12px 30px rgba(0,0,0,0.6)';
      toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      toast.style.display = 'flex';
      toast.style.alignItems = 'center';
      toast.style.gap = '8px';
      toast.style.maxWidth = '90%';
      toast.style.backdropFilter = 'blur(10px)';
      toast.style.webkitBackdropFilter = 'blur(10px)';
      document.body.appendChild(toast);
    }

    if (tipo === 'alerta') {
      toast.style.background = 'rgba(239, 68, 68, 0.92)';
      toast.style.border = '1px solid rgba(239, 68, 68, 0.4)';
      toast.style.color = '#FFFFFF';
      toast.innerHTML = `⚠️ <span>${mensagem}</span>`;
    } else {
      toast.style.background = 'rgba(16, 185, 129, 0.92)';
      toast.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      toast.style.color = '#03251E';
      toast.innerHTML = `✅ <span>${mensagem}</span>`;
    }

    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0px)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
    }, 3200);
  }

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
      radius: 10,
      color: '#10B981',
      fillColor: '#10B981',
      fillOpacity: 1,
      weight: 3
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 300);
    window.addEventListener('resize', () => map.invalidateSize());

    // Obter GPS real contínuo com alta precisão
    iniciarRastreioGPSReal();

    // Clique no mapa para definir destino
    map.on('click', (e) => {
      definirDestinoNoMapa(
        e.latlng.lat,
        e.latlng.lng,
        `Ponto selecionado (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`
      );
    });
  }

  function iniciarRastreioGPSReal() {
    if (!('geolocation' in navigator)) {
      mostrarToast('Geolocalização não suportada neste dispositivo.');
      return;
    }

    const opcoesGPS = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    };

    // Leitura imediata
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        atualizarPosicaoPassageiro(pos.coords.latitude, pos.coords.longitude, true);
      },
      (err) => {
        console.warn('GPS inicial falhou ou aguardando permissão:', err.message);
      },
      opcoesGPS
    );

    // Acompanhamento contínuo
    navigator.geolocation.watchPosition(
      (pos) => {
        atualizarPosicaoPassageiro(pos.coords.latitude, pos.coords.longitude, !gpsObtido);
      },
      (err) => console.warn('Erro contínuo de GPS:', err.message),
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
  }

  function atualizarPosicaoPassageiro(lat, lng, recentralizar = false) {
    clienteCoords = [lat, lng];
    gpsObtido = true;

    if (markerCliente) {
      markerCliente.setLatLng(clienteCoords);
    }

    if (recentralizar && map) {
      map.setView(clienteCoords, 16, { animate: true });
      map.invalidateSize();
    }

    const inputOrigem = document.getElementById('inputOrigem');
    if (inputOrigem) {
      inputOrigem.value = 'Minha localização atual (GPS Ativo)';
    }

    // Se já havia destino selecionado, atualiza o traçado pelas ruas
    if (pontoDestinoCoords) {
      calcularRotaViasUrbanas(clienteCoords, pontoDestinoCoords, false);
    }
  }

  // 2. MOTOR DE TRAÇADO POR RUAS (OSRM - ELIMINA A LINHA RETA)
  async function calcularRotaViasUrbanas(origem, destino, ajustarBounds = true) {
    const [lat1, lon1] = origem;
    const [lat2, lon2] = destino;

    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    try {
      const resposta = await fetch(url);
      const dados = await resposta.json();

      if (dados.routes && dados.routes.length > 0) {
        const rota = dados.routes[0];
        distanciaKmGlobal = Math.max(0.5, rota.distance / 1000);
        const minutosEstimados = Math.ceil(rota.duration / 60);

        const coordenadasGeoJson = rota.geometry.coordinates.map(p => [p[1], p[0]]);

        if (linhaTracaoRota) map.removeLayer(linhaTracaoRota);

        linhaTracaoRota = L.polyline(coordenadasGeoJson, {
          color: '#10B981',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        if (ajustarBounds && map) {
          map.fitBounds(linhaTracaoRota.getBounds(), { padding: [70, 70], animate: true });
        }

        recalcularValores(minutosEstimados);
        return;
      }
    } catch (err) {
      console.warn('OSRM temporariamente fora de alcance, usando estimativa auxiliar:', err);
    }

    // Fallback geométrico com linha pontilhada se o serviço falhar
    if (linhaTracaoRota) map.removeLayer(linhaTracaoRota);
    linhaTracaoRota = L.polyline([origem, destino], {
      color: '#10B981',
      weight: 4,
      dashArray: '6, 8',
      opacity: 0.85
    }).addTo(map);

    const metros = map.distance(L.latLng(origem), L.latLng(destino));
    distanciaKmGlobal = Math.max(0.5, (metros / 1000) * 1.3); // Fator de correção de curvas urbanas
    if (ajustarBounds && map) {
      const bounds = L.latLngBounds([origem, destino]);
      map.fitBounds(bounds, { padding: [70, 70], animate: true });
    }
    recalcularValores();
  }

  function definirDestinoNoMapa(lat, lng, textoExibicao = '') {
    pontoDestinoCoords = [lat, lng];

    if (!markerDestino) {
      const iconeDestino = L.divIcon({
        className: 'custom-dest-pin',
        html: '<div style="width:16px;height:16px;background:#FF6B00;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 0 10px rgba(255,107,0,0.8);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      markerDestino = L.marker(pontoDestinoCoords, { icon: iconeDestino }).addTo(map);
    } else {
      markerDestino.setLatLng(pontoDestinoCoords);
    }

    const inputDestino = document.getElementById('inputDestino');
    if (inputDestino && textoExibicao) {
      inputDestino.value = textoExibicao;
    }

    calcularRotaViasUrbanas(clienteCoords, pontoDestinoCoords, true);
  }

  // 3. BUSCA DE ENDEREÇO VIA NOMINATIM
  const btnBuscarEndereco = document.getElementById('btnBuscarEndereco');
  const inputDestino = document.getElementById('inputDestino');

  async function executarBuscaDestino() {
    const texto = inputDestino?.value.trim();
    if (!texto) {
      mostrarToast('Digite o nome de uma rua, bairro ou local no destino.');
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
        mostrarToast('Endereço não localizado. Toque diretamente no mapa.');
      }
    } catch (err) {
      console.warn('Erro ao pesquisar:', err);
      mostrarToast('Falha na busca. Toque diretamente no mapa.');
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

  // Botão Meu GPS (Recentraliza e força leitura com alta precisão)
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          atualizarPosicaoPassageiro(pos.coords.latitude, pos.coords.longitude, true);
          mostrarToast('GPS sincronizado com a sua posição real!', 'sucesso');
        },
        () => {
          if (map) map.setView(clienteCoords, 16, { animate: true });
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else if (map) {
      map.setView(clienteCoords, 16, { animate: true });
    }
  });

  // 4. CONFIGURAÇÃO DE TARIFAS
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

  // 5. CÁLCULO DE VALORES
  function recalcularValores(tempoMinutosFornecido = null) {
    const minutosEstimados = tempoMinutosFornecido !== null 
      ? tempoMinutosFornecido 
      : Math.max(3, Math.round(distanciaKmGlobal * 2.4 + 2));

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

  recalcularValores();

  // 6. ENVIAR PEDIDO COM COORDENADAS EXATAS
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
      origem: 'Localização atual do passageiro',
      destino: destinoTexto,
      coordsOrigem: [clienteCoords[0], clienteCoords[1]],
      coordsDestino: [destinoFinalCoords[0], destinoFinalCoords[1]],
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
      console.warn('Pedido armazenado localmente para o radar.', err);
    }

    if (bannerStatus) {
      bannerStatus.innerHTML = `✅ Pedido <strong>#${novoPedido.id}</strong> enviado com sucesso!<br><small>Aguardando motorista parceiro HUBy...</small>`;
      bannerTimer = setTimeout(() => {
        bannerStatus.classList.remove('ativo');
        bannerStatus.style.display = 'none';
      }, 5000);
    }
    
    mostrarToast(`Solicitação #${novoPedido.id} enviada!`, 'sucesso');
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