// ./js/modules/app-admin.js

document.addEventListener('DOMContentLoaded', () => {
  // 1. GUARDA DE SEGURANÇA ADMIN
  const tokenAdmin = localStorage.getItem('huby_admin_token');
  if (tokenAdmin !== 'token_admin_autorizado_998877') {
    alert('⚠️ Acesso restrito! Autentique-se como administrador para aceder.');
    window.location.replace('./login.html');
    return;
  }

  const API_URL = 'https://huby.onrender.com';
  const mapElement = document.getElementById('mapaAdmin');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim - PI

  // 2. INICIALIZAR MAPA ADMINISTRATIVO
  const map = L.map('mapaAdmin', {
    zoomControl: true,
    attributionControl: false
  }).setView(defaultCoords, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Recalcular viewport para eliminar blocos cinzentos
  setTimeout(() => map.invalidateSize(), 250);
  window.addEventListener('resize', () => map.invalidateSize());

  // Veículos simulados ativos na região
  const veiculos = [
    { nome: 'Tarcyo (HUBy Carro)', coords: [-7.7720, -42.2485], cor: '#10B981' },
    { nome: 'Carlos (HUBy Cargo VUC)', coords: [-7.7755, -42.2440], cor: '#F59E0B' },
    { nome: 'Lucas (HUBy Flash)', coords: [-7.7710, -42.2430], cor: '#3B82F6' }
  ];

  veiculos.forEach(v => {
    L.circleMarker(v.coords, {
      radius: 8,
      color: v.cor,
      fillColor: v.cor,
      fillOpacity: 0.95,
      weight: 2
    }).addTo(map).bindPopup(`<strong>${v.nome}</strong><br>Status: Disponível em campo`);
  });

  // 3. SINCRONIZAR FILA DE PEDIDOS EM TEMPO REAL
  async function carregarFilaAdmin() {
    const listaContainer = document.getElementById('listaPedidosAdmin');
    if (!listaContainer) return;

    let pedidos = [];

    try {
      const resp = await fetch(`${API_URL}/api/pedidos`);
      if (resp.ok) {
        pedidos = await resp.json();
      }
    } catch (e) {
      console.warn('API Admin em fallback local.');
    }

    if (!pedidos || pedidos.length === 0) {
      pedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    }

    if (pedidos.length === 0) {
      listaContainer.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #64748B; font-size: 12px;">
          Nenhum pedido ou frete ativo no momento.
        </div>
      `;
      return;
    }

    listaContainer.innerHTML = pedidos.map(p => {
      const isCargo = p.tipo === 'cargo';
      const isFlash = p.tipo === 'flash';
      const iconeClasse = isCargo ? 'cargo' : (isFlash ? 'flash' : 'emerald');
      const emoji = isCargo ? '🚚' : (isFlash ? '📦' : '🚗');

      return `
        <div class="admin-order-row">
          <div class="order-type-icon ${iconeClasse}">${emoji}</div>
          <div class="order-meta">
            <strong>#${p.id} • ${p.sub_tipo_label || p.subTipoLabel || 'HUBy Viagem'}</strong>
            <span>Origem: ${p.origem}</span>
            <small>Destino: ${p.destino} (${p.distancia || '1.0 km'})</small>
          </div>
          <div class="order-status-box">
            <span class="status-pill em-rota">${p.status || 'Pendente'}</span>
            <strong>${p.preco}</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  setInterval(carregarFilaAdmin, 5000);
  carregarFilaAdmin();
});