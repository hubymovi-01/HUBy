/**
 * ============================================================================
 * HUBy 2.6 - Motor de Pesquisa Direta (Partida e Destino) por Proximidade
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

  resultados.sort((a, b) => a.distanciaKm - b.distanciaKm);
  return resultados.slice(0, 7);
}

export function configurarPesquisaLocal(hubyMapa, aoSelecionarLocal, aoSelecionarOrigem = null) {
  const inputOrigem = document.getElementById('inputOrigemLocal');
  const inputDestino = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');

  let timeoutPesquisa = null;
  let campoAtivo = 'destino'; // 'origem' | 'destino'

  if (!inputDestino || !listaResultados) return;

  const executarBusca = async (termo, alvo) => {
    if (termo.length < 2) {
      listaResultados.style.display = 'none';
      return;
    }

    listaResultados.innerHTML = `
      <li class="search-result-item">
        <div class="result-text">
          <strong style="color: #38BDF8;">Buscando endereços...</strong>
          <small>Priorizando locais próximos</small>
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
              <small>Digite o nome da rua ou cidade (ex: Teresina, São João do Piauí)</small>
            </div>
          </li>
        `;
        return;
      }

      dados.forEach((local) => {
        const li = document.createElement('li');
        li.className = 'search-result-item';

        const distBadge = formatarDistanciaCurta(local.distanciaKm);
        const icone = alvo === 'origem' ? '🟢' : '📍';

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

        li.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          listaResultados.style.display = 'none';

          if (alvo === 'origem') {
            if (inputOrigem) inputOrigem.value = local.nomeCurto;
            if (hubyMapa) {
              hubyMapa.definirOrigem(local.lat, local.lng, null, true);
            }
            if (typeof aoSelecionarOrigem === 'function') {
              await aoSelecionarOrigem([local.lat, local.lng], local.nomeCurto);
            }
            // Move o foco para o destino sem apagar o que foi escolhido na origem
            campoAtivo = 'destino';
            inputDestino.focus();
            return;
          }

          inputDestino.value = local.nomeCurto;
          if (btnLimpar) btnLimpar.style.display = 'inline-block';

          if (hubyMapa && hubyMapa.coordsOrigem) {
            const rota = await hubyMapa.calcularRota(hubyMapa.coordsOrigem, [local.lat, local.lng], '#10B981', true);
            aoSelecionarLocal(rota, [local.lat, local.lng], local.nomeCurto);
          }
        });

        listaResultados.appendChild(li);
      });
    } catch (err) {
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

  if (inputOrigem) {
    inputOrigem.addEventListener('focus', () => {
      campoAtivo = 'origem';
    });
    inputOrigem.addEventListener('input', (e) => {
      campoAtivo = 'origem';
      const termo = e.target.value.trim();
      clearTimeout(timeoutPesquisa);
      timeoutPesquisa = setTimeout(() => executarBusca(termo, 'origem'), 450);
    });
  }

  inputDestino.addEventListener('focus', () => {
    campoAtivo = 'destino';
  });

  inputDestino.addEventListener('input', (e) => {
    campoAtivo = 'destino';
    const termo = e.target.value.trim();
    if (btnLimpar) btnLimpar.style.display = termo.length > 0 ? 'inline-block' : 'none';
    clearTimeout(timeoutPesquisa);
    timeoutPesquisa = setTimeout(() => executarBusca(termo, 'destino'), 450);
  });

  btnLimpar?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputDestino.value = '';
    btnLimpar.style.display = 'none';
    listaResultados.style.display = 'none';
    inputDestino.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.client-dock-sheet')) {
      listaResultados.style.display = 'none';
    }
  });
}