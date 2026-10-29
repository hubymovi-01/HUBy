/**
 * ============================================================================
 * HUBy 2.0 - Motor de Pesquisa Modular (js/pesquisa.js)
 * ============================================================================
 */

export function configurarPesquisaLocal(hubyMapa, aoSelecionarLocal) {
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');
  const btnPesquisar = document.getElementById('btnAcionarPesquisa');
  let timeoutPesquisa = null;

  if (!inputPesquisa || !listaResultados) return;

  const executarBusca = async (termo) => {
    if (termo.length < 3) return;
    
    // ABRIR A CAIXA IMEDIATAMENTE COM AVISO DE CARREGAMENTO
    listaResultados.innerHTML = `
      <li class="search-result-item">
        <div class="result-text">
          <strong style="color: #38BDF8;">A procurar morada...</strong>
          <small>A conectar ao satélite...</small>
        </div>
      </li>
    `;
    listaResultados.style.display = 'block';

    try {
      // INJEÇÃO DE IDIOMA PARA O SERVIDOR NÃO BLOQUEAR O TELEMÓVEL
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}&limit=5&countrycodes=br`, {
        headers: {
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
      const dados = await resp.json();
      
      listaResultados.innerHTML = '';
      
      if (dados.length === 0) {
        listaResultados.innerHTML = `
          <li class="search-result-item">
            <div class="result-text">
              <strong style="color: #F59E0B;">Nenhum local encontrado</strong>
              <small>Tente colocar o nome da cidade junto (ex: Simplício Mendes, PI)</small>
            </div>
          </li>
        `;
        return;
      }

      dados.forEach(local => {
        const li = document.createElement('li');
        li.className = 'search-result-item';
        
        const partesNome = local.display_name.split(',');
        const nomeCurto = partesNome[0];
        const ruaBairro = partesNome.length > 1 ? partesNome[1].trim() + (partesNome.length > 2 ? ', ' + partesNome[2].trim() : '') : '';
        
        li.innerHTML = `
          <div class="result-icon">📍</div> 
          <div class="result-text">
            <strong>${nomeCurto}</strong>
            <small>${ruaBairro}</small>
          </div>
        `;
        
        const selecionarLocal = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const lat = parseFloat(local.lat);
          const lng = parseFloat(local.lon);
          
          inputPesquisa.value = nomeCurto;
          listaResultados.style.display = 'none';
          
          if (hubyMapa && hubyMapa.coordsOrigem) {
            const rota = await hubyMapa.calcularRota(hubyMapa.coordsOrigem, [lat, lng], '#F59E0B', true);
            aoSelecionarLocal(rota, [lat, lng], nomeCurto);
          }
        };

        li.addEventListener('click', selecionarLocal);
        li.addEventListener('touchstart', selecionarLocal, { passive: false });
        
        listaResultados.appendChild(li);
      });
      
    } catch (err) {
      console.error('Erro na pesquisa:', err);
      listaResultados.innerHTML = `
        <li class="search-result-item">
          <div class="result-text">
            <strong style="color: #EF4444;">Erro de Ligação</strong>
            <small>Verifique a internet e tente novamente.</small>
          </div>
        </li>
      `;
    }
  };

  inputPesquisa.addEventListener('input', (e) => {
    const termo = e.target.value.trim();
    if (termo.length > 0) {
      btnLimpar.style.display = 'flex';
    } else {
      btnLimpar.style.display = 'none';
      listaResultados.style.display = 'none';
      return;
    }
    clearTimeout(timeoutPesquisa);
    timeoutPesquisa = setTimeout(() => executarBusca(termo), 800);
  });

  const forcarPesquisa = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const termo = inputPesquisa.value.trim();
    if (termo.length >= 3) {
      clearTimeout(timeoutPesquisa);
      executarBusca(termo);
    }
  };

  if (btnPesquisar) {
    btnPesquisar.addEventListener('click', forcarPesquisa);
    btnPesquisar.addEventListener('touchstart', forcarPesquisa, { passive: false });
  }

  inputPesquisa.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const termo = inputPesquisa.value.trim();
      if (termo.length >= 3) {
        clearTimeout(timeoutPesquisa);
        executarBusca(termo);
      }
    }
  });

  const limparCaixa = (e) => {
    e.preventDefault();
    e.stopPropagation();
    inputPesquisa.value = '';
    btnLimpar.style.display = 'none';
    listaResultados.style.display = 'none';
    inputPesquisa.focus();
  };

  if (btnLimpar) {
    btnLimpar.addEventListener('click', limparCaixa);
    btnLimpar.addEventListener('touchstart', limparCaixa, { passive: false });
  }
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-floating-wrapper')) {
      if (listaResultados) listaResultados.style.display = 'none';
    }
  });
}