/**
 * ============================================================================
 * HUBy 2.0 - Motor de Pesquisa Modular (js/pesquisa.js)
 * ============================================================================
 */

export function configurarPesquisaLocal(hubyMapa, aoSelecionarLocal) {
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  const listaResultados = document.getElementById('listaResultadosPesquisa');
  let timeoutPesquisa = null;

  if (!inputPesquisa || !listaResultados) return;

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
    timeoutPesquisa = setTimeout(async () => {
      if (termo.length < 3) return;
      
      try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(termo)}&limit=5&countrycodes=br`);
        const dados = await resp.json();
        
        listaResultados.innerHTML = '';
        
        if (dados.length === 0) {
          listaResultados.innerHTML = '<li class="search-result-item"><div class="result-text"><strong style="color: #F59E0B;">Nenhum local encontrado</strong><small>Tente um nome diferente</small></div></li>';
          listaResultados.style.display = 'block';
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
          
          li.addEventListener('click', async () => {
            const lat = parseFloat(local.lat);
            const lng = parseFloat(local.lon);
            
            inputPesquisa.value = nomeCurto;
            listaResultados.style.display = 'none';
            
            if (hubyMapa && hubyMapa.coordsOrigem) {
              // Desenha a linha laranja no mapa
              const rota = await hubyMapa.calcularRota(hubyMapa.coordsOrigem, [lat, lng], '#F59E0B', true);
              // Devolve a informação para o app-cliente atualizar preços e textos
              aoSelecionarLocal(rota, [lat, lng], nomeCurto);
            }
          });
          
          listaResultados.appendChild(li);
        });
        
        listaResultados.style.display = 'block';
      } catch (err) {
        console.error('Erro na pesquisa:', err);
      }
    }, 600);
  });

  btnLimpar?.addEventListener('click', () => {
    inputPesquisa.value = '';
    btnLimpar.style.display = 'none';
    listaResultados.style.display = 'none';
  });
  
  // Fecha a lista se clicar fora dela
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-floating-wrapper')) {
      listaResultados.style.display = 'none';
    }
  });
}