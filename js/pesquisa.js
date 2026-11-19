/**
 * ============================================================================
 * HUBy 2.5 - Motor de Pesquisa Inteligente por Proximidade + De Onde / Para Onde
 * ============================================================================
 */

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatarDistanciaCurta(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 1000))} m`;
  if (km < 100) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

async function buscarLocaisProximos(termo, refLat, refLng) {
  const resultados = [];
  const chavesVistas = new Set();

  // 1. Photon (Komoot/OSM) - Excelente para viés por proximidade (lat/lon)
  try {
    const urlPhoton = `https://photon.komoot.io/api/?q=${encodeURIComponent(termo)}&lat=${refLat}&lon=${refLng}&limit=8&lang=default`;
    const resp = await fetch(urlPhoton);
    if (resp.ok) {
      const json = await resp.json();
      const features = Array.isArray(json.features) ? json.features : [];

      for (const f of features) {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const pais = String(props.countrycode || props.country || '').toLowerCase();
        if (pais && pais !== 'br' && !pais.includes('brasil') && !pais.includes('brazil')) continue;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        const nomePrincipal = props.name || props.street || props.city || termo;
        const ruaNumero = props.street
          ? `${props.street}${props.housenumber ? ', ' + props.housenumber : ''}`
          : '';
        const cidadeEstado = [props.district || props.suburb, props.city || props.town || props.village, props.state]
          .filter(Boolean)
          .join(' • ');

        const subtitulo = [ruaNumero !== nomePrincipal ? ruaNumero : '', cidadeEstado]
          .filter(Boolean)
          .join(' — ');

        const chave = `${nomePrincipal.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
        if (chavesVistas.has(chave)) continue;
        chavesVistas.add(chave);

        resultados.push({
          nomeCurto: nomePrincipal,
          detalhe: subtitulo || 'Brasil',
          lat,
          lng,
          distanciaKm: calcularDistanciaKm(refLat, refLng, lat, lng)
        });
      }
    }
  } catch (e) {}

  // 2. Nominatim com viewbox local (~55 km ao redor do usuário) como reforço
  if (resultados.length < 4) {
    try {
      const delta = 0.5;
      const viewbox = `${refLng - delta},${refLat + delta},${refLng + delta},${refLat - delta}`;
      const urlNom = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}&limit=6&countrycodes=br&addressdetails=1&viewbox=${viewbox}&accept-language=pt-BR`;
      const resp = await fetch(urlNom);
      if (resp.ok) {
        const dados = await resp.json();
        for (const local of dados) {
          const lat = parseFloat(local.lat);
          const lng = parseFloat(local.lon);
          const addr = local.address || {};
          const partesNome = String(local.display_name || '').split(',');
          const nomeCurto = partesNome[0]?.trim() || termo;
          const cidade = addr.city || addr.town || addr.village || addr.municipality || '';
          const estado = addr.state || '';
          const bairro = addr.suburb || addr.neighbourhood || '';
          const detalhe = [bairro, cidade, estado].filter(Boolean).join(' • ') || partesNome.slice(1, 3).join(', ').trim();

          const chave = `${nomeCurto.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
          if (chavesVistas.has(chave)) continue;
          chavesVistas.add(chave);

          resultados.push({
            nomeCurto,
            detalhe,
            lat,
            lng,
            distanciaKm: calcularDistanciaKm(refLat, refLng, lat, lng)
          });
        }
      }
    } catch (e) {}
  }

  // Ordena priorizando os mais próximos do usuário
  resultados.sort((a, b) => a.distanciaKm - b.distanciaKm);
  return resultados.slice(0, 7);
}

export function configurarPesquisaLocal(hubyMapa, aoSelecionarLocal, aoSelecionarOrigem = null) {
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');
  const btnPesquisar = document.getElementById('btnAcionarPesquisa');
  const tabOrigem = document.getElementById('tabBuscarOrigem');
  const tabDestino = document.getElementById('tabBuscarDestino');
  const searchDot = document.getElementById('searchDotIndicator');

  let timeoutPesquisa = null;
  let modoBuscaAtual = 'destino'; // 'origem' | 'destino'

  if (!inputPesquisa || !listaResultados) return;

  const definirModoBusca = (novoModo, focarInput = false) => {
    modoBuscaAtual = novoModo === 'origem' ? 'origem' : 'destino';

    if (tabOrigem && tabDestino) {
      if (modoBuscaAtual === 'origem') {
        tabOrigem.classList.add('active-origem');
        tabDestino.classList.remove('active-destino');
        inputPesquisa.placeholder = 'De onde vai sair? (Ex: Rua, Bairro, Cidade...)';
        if (searchDot) searchDot.style.background = '#10B981';
      } else {
        tabDestino.classList.add('active-destino');
        tabOrigem.classList.remove('active-origem');
        inputPesquisa.placeholder = 'Para onde você quer ir?';
        if (searchDot) searchDot.style.background = '#38BDF8';
      }
    }

    if (focarInput) {
      document.querySelector('.modern-search')?.classList.add('active');
      inputPesquisa.value = '';
      if (btnLimpar) btnLimpar.style.display = 'none';
      listaResultados.style.display = 'none';
      inputPesquisa.focus();
    }
  };

  window.definirModoBuscaHUBy = definirModoBusca;

  tabOrigem?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    definirModoBusca('origem', true);
  });

  tabDestino?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    definirModoBusca('destino', true);
  });

  const executarBusca = async (termo) => {
    if (termo.length < 2) return;

    listaResultados.innerHTML = `
      <li class="search-result-item">
        <div class="result-text">
          <strong style="color: #38BDF8;">Buscando locais próximos...</strong>
          <small>Priorizando endereços perto de você</small>
        </div>
      </li>
    `;
    listaResultados.style.display = 'block';

    try {
      const refCoords = hubyMapa?.coordsOrigem || hubyMapa?.coordsGPSReal || [-8.3580, -42.2460];
      const dados = await buscarLocaisProximos(termo, refCoords[0], refCoords[1]);

      listaResultados.innerHTML = '';

      if (dados.length === 0) {
        listaResultados.innerHTML = `
          <li class="search-result-item">
            <div class="result-text">
              <strong style="color: #F59E0B;">Nenhum local encontrado</strong>
              <small>Tente informar o nome da rua ou cidade (ex: Teresina, São João do Piauí)</small>
            </div>
          </li>
        `;
        return;
      }

      dados.forEach((local) => {
        const li = document.createElement('li');
        li.className = 'search-result-item';

        const distBadge = formatarDistanciaCurta(local.distanciaKm);
        const icone = modoBuscaAtual === 'origem' ? '🟢' : '📍';

        li.innerHTML = `
          <div class="result-icon">${icone}</div>
          <div class="result-text" style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
              <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${local.nomeCurto}</strong>
              <span style="font-size: 10px; font-weight: 800; color: #10B981; background: rgba(16,185,129,0.14); padding: 2px 7px; border-radius: 999px; flex-shrink: 0;">
                ${distBadge}
              </span>
            </div>
            <small>${local.detalhe}</small>
          </div>
        `;

        const selecionarLocal = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          listaResultados.style.display = 'none';

          if (modoBuscaAtual === 'origem') {
            if (hubyMapa) {
              hubyMapa.definirOrigem(local.lat, local.lng, null, true);
            }
            if (typeof aoSelecionarOrigem === 'function') {
              await aoSelecionarOrigem([local.lat, local.lng], local.nomeCurto);
            }
            // Depois de escolher "De onde", muda automaticamente para "Para onde"
            definirModoBusca('destino', true);
            return;
          }

          inputPesquisa.value = local.nomeCurto;
          if (btnLimpar) btnLimpar.style.display = 'flex';

          if (hubyMapa && hubyMapa.coordsOrigem) {
            const rota = await hubyMapa.calcularRota(hubyMapa.coordsOrigem, [local.lat, local.lng], '#F59E0B', true);
            aoSelecionarLocal(rota, [local.lat, local.lng], local.nomeCurto);
          }
        };

        li.addEventListener('click', selecionarLocal);
        listaResultados.appendChild(li);
      });
    } catch (err) {
      console.error('Erro na pesquisa:', err);
      listaResultados.innerHTML = `
        <li class="search-result-item">
          <div class="result-text">
            <strong style="color: #EF4444;">Erro de Ligação</strong>
            <small>Sem resposta do mapa. Tente novamente.</small>
          </div>
        </li>
      `;
    }
  };

  inputPesquisa.addEventListener('input', (e) => {
    const termo = e.target.value.trim();
    if (termo.length > 0) {
      if (btnLimpar) btnLimpar.style.display = 'flex';
    } else {
      if (btnLimpar) btnLimpar.style.display = 'none';
      listaResultados.style.display = 'none';
      return;
    }
    clearTimeout(timeoutPesquisa);
    timeoutPesquisa = setTimeout(() => executarBusca(termo), 450);
  });

  const forcarPesquisa = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const termo = inputPesquisa.value.trim();
    if (termo.length >= 2) {
      clearTimeout(timeoutPesquisa);
      executarBusca(termo);
    }
  };

  if (btnPesquisar) {
    btnPesquisar.addEventListener('click', forcarPesquisa);
  }

  inputPesquisa.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const termo = inputPesquisa.value.trim();
      if (termo.length >= 2) {
        clearTimeout(timeoutPesquisa);
        executarBusca(termo);
      }
    }
  });

  const limparCaixa = (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputPesquisa.value = '';
    if (btnLimpar) btnLimpar.style.display = 'none';
    listaResultados.style.display = 'none';
    inputPesquisa.focus();
  };

  if (btnLimpar) {
    btnLimpar.addEventListener('click', limparCaixa);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-floating-wrapper')) {
      if (listaResultados) listaResultados.style.display = 'none';
    }
  });
}