// ./js/modules/app-cliente.js

import { MapaService } from '../services/mapa-service.js';
import { ApiClient } from '../services/api-client.js';
import { CATEGORIAS_HUBY, calcularOrcamentoViagem, formatarMoedaBRL } from '../config/tarifas.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. ESTADOS DA APLICAÇÃO
  let grupoSelecionado = 'carro';
  let subVeiculoId = 'carro';
  let distanciaKmAtual = 1.5;
  let duracaoMinAtual = 4;
  let coordsOrigem = [-8.3580, -41.8950];
  let coordsDestino = null;

  let qtdAjudantes = 0;
  let temEscada = false;
  let temParadaExtra = false;

  // 2. SISTEMA VISUAL DE NOTIFICAÇÃO TOAST
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

  // 3. INICIALIZAR SERVIÇO DE MAPA E ROTAS
  const mapaService = new MapaService('mapaCliente');

  mapaService.inicializarMapa(async (rota, pontoDest) => {
    coordsDestino = [pontoDest.lat, pontoDest.lng];
    distanciaKmAtual = rota.distanciaKm;
    duracaoMinAtual = rota.duracaoMin;

    const inputDestino = document.getElementById('inputDestino');
    if (inputDestino && !inputDestino.value) {
      inputDestino.value = `Ponto selecionado (${pontoDest.lat.toFixed(4)}, ${pontoDest.lng.toFixed(4)})`;
    }

    atualizarOrcamentoInterface();
  });

  // Força o mapa a preencher a tela após o desaparecimento do splash
  setTimeout(() => {
    mapaService.invalidarTamanho();
  }, 300);

  // Captura o GPS Contínuo
  mapaService.obterGPSAtual((pos) => {
    coordsOrigem = [pos.lat, pos.lng];
    const inputOrigem = document.getElementById('inputOrigem');
    if (inputOrigem) {
      inputOrigem.value = 'Minha localização atual (GPS Ativo)';
    }

    if (coordsDestino) {
      mapaService.calcularRotaOSRM(coordsOrigem, coordsDestino).then((rota) => {
        distanciaKmAtual = rota.distanciaKm;
        duracaoMinAtual = rota.duracaoMin;
        atualizarOrcamentoInterface();
      });
    }
  }, true);

  // Botão Recentralizar GPS
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    mapaService.obterGPSAtual((pos) => {
      coordsOrigem = [pos.lat, pos.lng];
      mostrarToast('GPS sincronizado com a sua posição real!', 'sucesso');
    }, false);
  });

  // 4. PESQUISA DE ENDEREÇO VIA NOMINATIM
  const btnBuscarEndereco = document.getElementById('btnBuscarEndereco');
  const inputDestino = document.getElementById('inputDestino');

  async function processarBuscaEndereco() {
    const texto = inputDestino?.value.trim();
    if (!texto) {
      mostrarToast('Digite o endereço ou local de destino.');
      return;
    }

    if (btnBuscarEndereco) {
      btnBuscarEndereco.textContent = '⏳';
      btnBuscarEndereco.disabled = true;
    }

    const resultado = await mapaService.buscarEnderecoNominatim(texto);

    if (resultado) {
      coordsDestino = [resultado.lat, resultado.lng];
      mapaService.definirMarcadorDestino(resultado.lat, resultado.lng);
      inputDestino.value = resultado.nome;

      const rota = await mapaService.calcularRotaOSRM(coordsOrigem, coordsDestino);
      distanciaKmAtual = rota.distanciaKm;
      duracaoMinAtual = rota.duracaoMin;
      atualizarOrcamentoInterface();
    } else {
      mostrarToast('Endereço não localizado. Toque diretamente no mapa.');
    }

    if (btnBuscarEndereco) {
      btnBuscarEndereco.textContent = 'Ir';
      btnBuscarEndereco.disabled = false;
    }
  }

  btnBuscarEndereco?.addEventListener('click', processarBuscaEndereco);
  inputDestino?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processarBuscaEndereco();
    }
  });

  // 5. RENDERIZAÇÃO DE SUB-VEÍCULOS (CENTRALIZADO EM TARIFAS.JS)
  const containerSub = document.getElementById('containerSubVeiculos');
  const linhaAjudante = document.getElementById('linhaAjudante');
  const linhaEscada = document.getElementById('linhaEscada');

  function renderizarSubVeiculos() {
    if (!containerSub) return;

    const categoriasDoGrupo = Object.values(CATEGORIAS_HUBY).filter(c => c.grupo === grupoSelecionado);

    containerSub.innerHTML = categoriasDoGrupo.map((v, i) => `
      <button type="button" class="sub-pill ${i === 0 ? 'active' : ''}" data-id="${v.id}" data-nome="${v.nome}">
        ${v.icone} ${v.nome}
      </button>
    `).join('');

    subVeiculoId = categoriasDoGrupo[0]?.id || 'carro';

    containerSub.querySelectorAll('.sub-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        containerSub.querySelectorAll('.sub-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        subVeiculoId = btn.getAttribute('data-id');
        atualizarOrcamentoInterface();
      });
    });

    if (grupoSelecionado === 'cargo') {
      if (linhaAjudante) linhaAjudante.style.display = 'flex';
      if (linhaEscada) linhaEscada.style.display = 'flex';
    } else {
      if (linhaAjudante) linhaAjudante.style.display = 'none';
      if (linhaEscada) linhaEscada.style.display = 'none';
      qtdAjudantes = 0;
      temEscada = false;
      const txtQtd = document.getElementById('txtQtdAjudantes');
      if (txtQtd) txtQtd.textContent = '0';
      const chkEsc = document.getElementById('chkEscada');
      if (chkEsc) chkEsc.checked = false;
    }

    atualizarOrcamentoInterface();
  }

  // Abas de Grupos (Viagem / Flash / Cargo)
  document.querySelectorAll('.tab-card').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-card').forEach(t => t.className = 'tab-card');
      const g = tab.getAttribute('data-grupo');
      tab.classList.add(`active-${g}`);
      grupoSelecionado = g;
      renderizarSubVeiculos();
    });
  });

  // Controles de Adicionais
  const txtQtdAjudantes = document.getElementById('txtQtdAjudantes');
  document.getElementById('btnMenosAjudante')?.addEventListener('click', () => {
    if (qtdAjudantes > 0) {
      qtdAjudantes--;
      if (txtQtdAjudantes) txtQtdAjudantes.textContent = qtdAjudantes;
      atualizarOrcamentoInterface();
    }
  });

  document.getElementById('btnMaisAjudante')?.addEventListener('click', () => {
    if (qtdAjudantes < 4) {
      qtdAjudantes++;
      if (txtQtdAjudantes) txtQtdAjudantes.textContent = qtdAjudantes;
      atualizarOrcamentoInterface();
    }
  });

  document.getElementById('chkEscada')?.addEventListener('change', (e) => {
    temEscada = e.target.checked;
    atualizarOrcamentoInterface();
  });

  document.getElementById('chkParadaExtra')?.addEventListener('change', (e) => {
    temParadaExtra = e.target.checked;
    atualizarOrcamentoInterface();
  });

  // 6. CÁLCULO DE ORÇAMENTO CENTRALIZADO
  function atualizarOrcamentoInterface() {
    const orcamento = calcularOrcamentoViagem(subVeiculoId, distanciaKmAtual, duracaoMinAtual, {
      qtdAjudantes,
      temEscada,
      paradasExtras: temParadaExtra ? 1 : 0
    });

    const txtDistKm = document.getElementById('txtDistKm');
    if (txtDistKm) txtDistKm.textContent = `${orcamento.distanciaKm} km`;

    const txtDuracaoMin = document.getElementById('txtDuracaoMin');
    if (txtDuracaoMin) txtDuracaoMin.textContent = orcamento.duracaoMin;

    const txtValorAdicionais = document.getElementById('txtValorAdicionais');
    if (txtValorAdicionais) txtValorAdicionais.textContent = formatarMoedaBRL(orcamento.valorAdicionais);

    const txtPrecoFinal = document.getElementById('txtPrecoFinal');
    if (txtPrecoFinal) txtPrecoFinal.textContent = orcamento.valorTotalFormatado;

    const txtBotaoAcao = document.getElementById('txtBotaoAcao');
    if (txtBotaoAcao) txtBotaoAcao.textContent = `Chamar ${orcamento.categoriaNome}`;

    return orcamento;
  }

  renderizarSubVeiculos();

  // 7. ENVIO DO PEDIDO (CHAMA DIRETAMENTE O API-CLIENT)
  const btnSolicitar = document.getElementById('btnSolicitarHuby');
  const bannerStatus = document.getElementById('bannerStatusCorrida');
  let bannerTimer = null;

  btnSolicitar?.addEventListener('click', async () => {
    const destinoTexto = inputDestino?.value.trim() || 'Ponto selecionado no mapa';
    const metodoPgto = document.getElementById('selectMetodoPgto')?.value || 'pix_app';

    const destinoFinalCoords = coordsDestino || [
      coordsOrigem[0] + 0.007,
      coordsOrigem[1] + 0.007
    ];

    const orcamentoFinal = atualizarOrcamentoInterface();

    btnSolicitar.disabled = true;

    if (bannerStatus) {
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerStatus.className = 'status-banner ativo';
      bannerStatus.style.display = 'block';
      bannerStatus.innerHTML = `⏳ A transmitir pedido para motoristas próximos...`;
    }

    try {
      const pedidoCriado = await ApiClient.solicitarViagem({
        tipo: grupoSelecionado,
        subTipoLabel: orcamentoFinal.categoriaNome,
        origem: 'Localização atual do passageiro',
        destino: destinoTexto,
        coordsOrigem: [coordsOrigem[0], coordsOrigem[1]],
        coordsDestino: [destinoFinalCoords[0], destinoFinalCoords[1]],
        distancia: `${orcamentoFinal.distanciaKm} km`,
        preco: orcamentoFinal.valorTotalFormatado,
        metodoPgto: metodoPgto
      });

      if (bannerStatus) {
        bannerStatus.innerHTML = `✅ Pedido <strong>#${pedidoCriado.id}</strong> enviado!<br><small>Aguardando aceite do parceiro HUBy...</small>`;
        bannerTimer = setTimeout(() => {
          bannerStatus.classList.remove('ativo');
          bannerStatus.style.display = 'none';
        }, 5000);
      }

      mostrarToast(`Chamada #${pedidoCriado.id} enviada com sucesso!`, 'sucesso');
    } catch (err) {
      mostrarToast('Falha na conexão. Tentando reenvio local...', 'alerta');
    } finally {
      btnSolicitar.disabled = false;
    }
  });

  // 8. CONTROLE DE NAVEGAÇÃO POR ABAS INFERIORES
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
        setTimeout(() => mapaService.invalidarTamanho(), 200);
      }
    });
  });

  // Suporte a cards de atalho na aba Opções
  document.querySelectorAll('.action-solicitar').forEach(card => {
    card.addEventListener('click', () => {
      const g = card.getAttribute('data-target-group');
      const navInicio = document.querySelector('.nav-item[data-tab="viewInicio"]');
      navInicio?.click();

      const tabGrupo = document.querySelector(`.tab-card[data-grupo="${g}"]`);
      tabGrupo?.click();
    });
  });

  // 9. SINCRONIZAÇÃO DO PERFIL E LOGOUT DIRETO (ABA CONTA)
  const nomeCliente = localStorage.getItem('huby_cliente_nome');
  const emailCliente = localStorage.getItem('huby_cliente_email');
  const papelUsuario = localStorage.getItem('huby_user_role');

  const elNome = document.getElementById('txtPerfilNome');
  const elAvatar = document.getElementById('txtPerfilAvatar');
  const menuAdminBtn = document.getElementById('menuAdminBtn');

  if (nomeCliente && elNome) {
    elNome.textContent = nomeCliente;
  } else if (emailCliente && elNome) {
    elNome.textContent = emailCliente.split('@')[0];
  }

  if (elAvatar) {
    const textoBase = nomeCliente || emailCliente || 'Passageiro';
    const partes = textoBase.trim().split(' ');
    elAvatar.textContent = partes.length > 1
      ? (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
      : partes[0].substring(0, 2).toUpperCase();
  }

  // Exibe o botão do painel administrativo caso o perfil seja admin
  if (menuAdminBtn && (papelUsuario === 'admin' || localStorage.getItem('huby_admin_token'))) {
    menuAdminBtn.style.display = 'flex';
  }

  // Logout direto com redirecionamento limpo e sem loops
  const btnSairConta = document.getElementById('btnSairConta');
  if (btnSairConta) {
    // Remove event listeners antigos clonando o elemento
    const novoBtnSair = btnSairConta.cloneNode(true);
    btnSairConta.parentNode.replaceChild(novoBtnSair, btnSairConta);

    novoBtnSair.addEventListener('click', () => {
      if (confirm('Tem certeza de que deseja sair da sua conta?')) {
        localStorage.clear();
        window.location.replace('./login.html');
      }
    });
  }
});