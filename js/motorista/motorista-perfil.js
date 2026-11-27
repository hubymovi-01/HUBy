// js/motorista/motorista-perfil.js - Perfil do Motorista, Foto, Modo Entrega Extra e Sincronização de Estado
// Dados do veículo (placa, modelo, cor e ano) são só leitura: quem altera é a equipe HUBy.
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { carregarGanhosHoje, carregarExtratoFinanceiro } from './motorista-ganhos.js';
import {
  obterCodigoAtivacaoMotorista,
  definirCodigoAtivacaoMotorista,
  falarTexto
} from '../ia/motorista-ia.js';

const FOTO_PADRAO = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80';
const CAMPOS_VEICULO = ['editCarroModelo', 'editCarroPlaca', 'editCarroCor', 'editCarroAno'];

// Só aceita foto em base64 (imagem) ou link https
function fotoSegura(url) {
  const s = String(url || '').trim();
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]{5,500}$/.test(s)) return s;
  return FOTO_PADRAO;
}

function texto(valor, padrao = '--') {
  const s = String(valor ?? '').trim();
  return s || padrao;
}

function garantirToggleEntregaNoDrawer(aceitaEntregaAtual) {
  const chkDinheiro = document.getElementById('chkAceitaDinheiro');
  const containerLista = chkDinheiro?.closest('div');
  if (!containerLista) return;

  let chkEntrega = document.getElementById('chkAceitaEntregaExtra');
  if (!chkEntrega) {
    const labelEntrega = document.createElement('label');
    labelEntrega.style.cssText = 'display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08);';
    labelEntrega.innerHTML = `
      <span>📦 Fazer Entrega também</span>
      <input type="checkbox" id="chkAceitaEntregaExtra" style="accent-color: #F59E0B; width: 18px; height: 18px;">
    `;
    containerLista.appendChild(labelEntrega);
    chkEntrega = document.getElementById('chkAceitaEntregaExtra');
  }

  if (chkEntrega) {
    chkEntrega.checked = Boolean(aceitaEntregaAtual);
  }
}

// Deixa os campos do veículo travados no modal de edição, com aviso
function travarCamposVeiculo() {
  CAMPOS_VEICULO.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = true;
    el.setAttribute('aria-readonly', 'true');
    el.style.opacity = '0.6';
    el.style.cursor = 'not-allowed';
  });

  const campoAno = document.getElementById('editCarroAno');
  if (campoAno && !document.getElementById('avisoVeiculoTravado')) {
    const aviso = document.createElement('small');
    aviso.id = 'avisoVeiculoTravado';
    aviso.style.cssText = 'display: block; color: #FBBF24; font-size: 11px; font-weight: 700; margin: -4px 0 8px; line-height: 1.35;';
    aviso.textContent = '🔒 Os dados do veículo só podem ser alterados pela equipe HUBy. Para trocar de carro, fale com o suporte.';
    campoAno.closest('.form-group-driver')?.insertAdjacentElement('afterend', aviso);
  }
}

export async function carregarPerfil() {
  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });

    if (!resp.ok) return null;
    const motorista = await resp.json();
    if (!motorista) return null;

    estado.motoristaId = motorista.id;
    estado.motoristaNome = texto(motorista.nome, 'Motorista');
    estado.categoriaMotorista = String(motorista.categoria || 'carro').toLowerCase();
    estado.aceitaEntrega = Boolean(motorista.aceita_entrega);
    estado.statusAprovacaoAtual = motorista.status_aprovacao || 'pendente';
    estado.saldoCarteira = Number(motorista.saldo_carteira || 0);
    estado.aceitaDinheiro = motorista.aceita_dinheiro !== false;
    estado.aceitaCartao = motorista.aceita_cartao !== false;
    estado.aceitaPix = motorista.aceita_pix !== false;
    estado.dadosMotorista = motorista;

    if (motorista.taxa_huby_atual !== undefined && Number.isFinite(Number(motorista.taxa_huby_atual))) {
      estado.taxaHubyMotorista = Number(motorista.taxa_huby_atual);
    }

    // O servidor é quem diz se o motorista está online
    if (typeof motorista.status_online === 'boolean') {
      estado.isOnline = motorista.status_online;
      estado.statusOnline = motorista.status_online;
    }

    const inVoz = document.getElementById('drawerInputCodigoVoz');
    if (inVoz) {
      if (motorista.codigo_voz && String(motorista.codigo_voz).trim()) {
        localStorage.setItem('huby_codigo_voz_motorista', String(motorista.codigo_voz).trim());
        inVoz.value = String(motorista.codigo_voz).trim();
      } else {
        inVoz.value = obterCodigoAtivacaoMotorista();
      }
    }

    const avaliacaoVal = Number(motorista.avaliacao_media || motorista.avaliacao || 5.0).toFixed(1);
    const totalCorridasVal = Number(motorista.total_corridas || 0);
    const foto = fotoSegura(motorista.foto_perfil_url);

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');

    if (topNome) topNome.textContent = estado.motoristaNome;
    if (topNota) topNota.textContent = `⭐ ${avaliacaoVal}`;
    if (topAvatar) topAvatar.src = foto;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerCat = document.getElementById('drawerCategoriaBadge');
    const drawerNota = document.getElementById('drawerAvaliacaoTxt');
    const drawerViagens = document.getElementById('drawerTotalViagensTxt');
    const drawerFoto = document.getElementById('drawerFotoImg');

    const catTxt = estado.categoriaMotorista.toUpperCase().replace(/[^A-Z]/g, '') || 'CARRO';
    const catExibicao = estado.aceitaEntrega && estado.categoriaMotorista !== 'entrega'
      ? `HUBY ${catTxt} + ENTREGA`
      : `HUBY ${catTxt}`;

    if (drawerNome) drawerNome.textContent = estado.motoristaNome;
    if (drawerCat) drawerCat.textContent = catExibicao;
    if (drawerNota) drawerNota.textContent = `⭐ ${avaliacaoVal}`;
    if (drawerViagens) drawerViagens.textContent = `${totalCorridasVal} ${totalCorridasVal === 1 ? 'viagem' : 'viagens'}`;
    if (drawerFoto) drawerFoto.src = foto;

    const drawerCarroModelo = document.getElementById('drawerCarroModelo');
    const drawerCarroDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerCarroPlaca = document.getElementById('drawerCarroPlaca');

    if (drawerCarroModelo) drawerCarroModelo.textContent = texto(motorista.veiculo_modelo, 'Veículo não informado');
    if (drawerCarroDetalhes) drawerCarroDetalhes.textContent = `Cor: ${texto(motorista.veiculo_cor)} • Ano: ${texto(motorista.veiculo_ano)}`;
    if (drawerCarroPlaca) drawerCarroPlaca.textContent = texto(motorista.veiculo_placa, '-------').toUpperCase();

    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    const checkDinheiro = document.getElementById('chkAceitaDinheiro');
    const checkCartao = document.getElementById('chkAceitaCartao');
    const checkPix = document.getElementById('chkAceitaPix');

    if (checkDinheiro) checkDinheiro.checked = estado.aceitaDinheiro;
    if (checkCartao) checkCartao.checked = estado.aceitaCartao;
    if (checkPix) checkPix.checked = estado.aceitaPix;

    garantirToggleEntregaNoDrawer(estado.aceitaEntrega);

    const inputPixDrawer = document.getElementById('drawerInputChavePix');
    if (inputPixDrawer && motorista.chave_pix_padrao && document.activeElement !== inputPixDrawer) {
      inputPixDrawer.value = motorista.chave_pix_padrao;
      localStorage.setItem('huby_motorista_pix', motorista.chave_pix_padrao);
    }

    const editNome = document.getElementById('editNome');
    const editTelefone = document.getElementById('editTelefone');
    const editModelo = document.getElementById('editCarroModelo');
    const editPlaca = document.getElementById('editCarroPlaca');
    const editCor = document.getElementById('editCarroCor');
    const editAno = document.getElementById('editCarroAno');
    const prevFoto = document.getElementById('previewFotoModal');

    if (editNome) editNome.value = motorista.nome || '';
    if (editTelefone) editTelefone.value = motorista.telefone || '';
    if (editModelo) editModelo.value = motorista.veiculo_modelo || '';
    if (editPlaca) editPlaca.value = motorista.veiculo_placa || '';
    if (editCor) editCor.value = motorista.veiculo_cor || '';
    if (editAno) editAno.value = motorista.veiculo_ano || '';
    if (prevFoto) prevFoto.src = foto;
    travarCamposVeiculo();

    carregarGanhosHoje();
    carregarExtratoFinanceiro();

    return motorista;
  } catch (err) {
    console.warn('Erro ao carregar dados do perfil:', err);
    return null;
  }
}

export function configurarCodigoVozCopiloto() {
  const inputComando = document.getElementById('drawerInputCodigoVoz');
  const btnSalvar = document.getElementById('btnSalvarCodigoVoz');
  const btnTestar = document.getElementById('btnTestarCodigoVoz');

  if (inputComando) {
    inputComando.value = obterCodigoAtivacaoMotorista();
  }

  if (btnSalvar) {
    btnSalvar.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const novoComando = inputComando?.value?.trim().slice(0, 30);
      if (!novoComando) {
        notificar('Digite uma palavra-chave para ativar seu copiloto (ex: Zank, Falcão).', 'alerta');
        inputComando?.focus();
        return;
      }

      const sucesso = await definirCodigoAtivacaoMotorista(novoComando);
      if (sucesso) {
        notificar(`Código atualizado! Chame por "${novoComando}".`, 'sucesso');
      } else {
        notificar('Erro ao salvar comando.', 'erro');
      }
    };
  }

  if (btnTestar) {
    btnTestar.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comandoAtual = inputComando?.value?.trim() || obterCodigoAtivacaoMotorista();
      falarTexto(`Copiloto HUBy conectado. Basta dizer ${comandoAtual} e o que você precisa na corrida.`);
    };
  }
}

// Botão "Salvar" da chave Pix no menu (antes não fazia nada)
function configurarSalvarChavePix() {
  const btn = document.getElementById('btnSalvarChavePix');
  const input = document.getElementById('drawerInputChavePix');
  if (!btn || !input) return;

  btn.onclick = async (e) => {
    e.preventDefault();
    const chavePix = String(input.value || '').trim();
    if (chavePix.length < 5 || chavePix.length > 150) {
      notificar('Informe uma chave Pix válida (CPF, telefone, e-mail ou chave aleatória).', 'alerta');
      return;
    }

    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = '...';
    try {
      const resp = await fetch(`${API_URL}/api/motoristas/chave-pix`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ chavePix })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.erro || 'Não foi possível salvar a chave Pix.');
      localStorage.setItem('huby_motorista_pix', chavePix);
      notificar(data.mensagem || 'Chave Pix atualizada!', 'sucesso');
    } catch (err) {
      notificar(err instanceof TypeError ? 'Sem conexão. A chave Pix NÃO foi salva.' : err.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  };
}

export function configurarSalvarPreferenciasPagto() {
  configurarSalvarChavePix();

  const btnSalvar = document.getElementById('btnSalvarPreferenciasPagto');
  if (!btnSalvar) return;

  btnSalvar.onclick = async (e) => {
    e.preventDefault();
    const aceita_dinheiro = document.getElementById('chkAceitaDinheiro')?.checked ?? true;
    const aceita_cartao = document.getElementById('chkAceitaCartao')?.checked ?? true;
    const aceita_pix = document.getElementById('chkAceitaPix')?.checked ?? true;
    const aceita_entrega = document.getElementById('chkAceitaEntregaExtra')?.checked ?? false;

    if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
      notificar('Selecione ao menos uma forma de recebimento.', 'alerta');
      return;
    }

    btnSalvar.disabled = true;
    try {
      const resp = await fetch(`${API_URL}/api/pedidos/motoristas/preferencias-pagamento`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ aceita_dinheiro, aceita_cartao, aceita_pix, aceita_entrega })
      });

      if (resp.ok) {
        // Só muda o estado local depois que o servidor confirmou
        estado.aceitaDinheiro = aceita_dinheiro;
        estado.aceitaCartao = aceita_cartao;
        estado.aceitaPix = aceita_pix;
        estado.aceitaEntrega = aceita_entrega;

        const drawerCat = document.getElementById('drawerCategoriaBadge');
        if (drawerCat) {
          const catTxt = String(estado.categoriaMotorista || 'carro').toUpperCase().replace(/[^A-Z]/g, '') || 'CARRO';
          drawerCat.textContent = aceita_entrega && estado.categoriaMotorista !== 'entrega'
            ? `HUBY ${catTxt} + ENTREGA`
            : `HUBY ${catTxt}`;
        }
        notificar(
          aceita_entrega
            ? 'Preferências salvas! Modo Entrega também ativado.'
            : 'Preferências de pagamento salvas!',
          'sucesso'
        );
      } else {
        const data = await resp.json().catch(() => ({}));
        notificar(data.erro || 'Erro ao salvar preferências.', 'erro');
      }
    } catch (err) {
      notificar('Sem conexão. As preferências NÃO foram salvas.', 'erro');
    } finally {
      btnSalvar.disabled = false;
    }
  };
}

// Sair da conta: fica offline no servidor, desconecta e apaga só os dados de login
function configurarSairDaConta() {
  const btnSair = document.getElementById('btnLogoutMotorista');
  if (!btnSair || btnSair.dataset.configurado) return;
  btnSair.dataset.configurado = '1';

  btnSair.addEventListener('click', async (e) => {
    e.preventDefault();

    if (estado.pedidoAceitoAtual || estado.pedidoAtivo) {
      notificar('Finalize ou cancele a corrida atual antes de sair da conta.', 'alerta');
      return;
    }

    btnSair.style.pointerEvents = 'none';
    btnSair.textContent = 'Saindo...';

    try {
      const controle = new AbortController();
      const timer = setTimeout(() => controle.abort(), 4000);
      await fetch(`${API_URL}/api/pedidos/motoristas/meu-status-online`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ online: false }),
        signal: controle.signal
      }).catch(() => {});
      clearTimeout(timer);
    } catch (err) {}

    try { estado.socket?.disconnect(); } catch (err) {}
    try { estado.socketRadar?.disconnect(); } catch (err) {}

    // Guarda só preferências do aparelho (meta diária, endereços favoritos, voz do copiloto); o resto da sessão é apagado
    const manter = /^huby_(meta_diaria|endereco_|coords_|mot_casa_nome|ia_|regiao)/;
    Object.keys(localStorage)
      .filter((chave) => chave.startsWith('huby_') && !manter.test(chave))
      .forEach((chave) => localStorage.removeItem(chave));
    try { sessionStorage.clear(); } catch (err) {}

    window.location.replace('./welcome.html');
  });
}

export function configurarEdicaoPerfil() {
  configurarSairDaConta();

  const btnAbrir = document.getElementById('btnAbrirModalEdicaoPerfil');
  const modal = document.getElementById('modalEdicaoPerfil');
  const btnFechar = document.getElementById('btnFecharModalEdicao');
  const btnCancelar = document.getElementById('btnCancelarEdicao');
  const btnSalvar = document.getElementById('btnSalvarEdicaoPerfil');

  const inputFoto = document.getElementById('inputUploadFotoPerfil');
  const previewFoto = document.getElementById('previewFotoModal');

  let novaFotoBase64 = null;
  travarCamposVeiculo();

  if (btnAbrir) {
    btnAbrir.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      novaFotoBase64 = null;
      if (modal) {
        modal.style.display = 'flex';
        carregarPerfil();
      }
    };
  }

  const fecharModal = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    novaFotoBase64 = null;
    if (modal) modal.style.display = 'none';
  };

  if (btnFechar) btnFechar.onclick = fecharModal;
  if (btnCancelar) btnCancelar.onclick = fecharModal;

  if (inputFoto) {
    inputFoto.onchange = () => {
      const file = inputFoto.files?.[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        notificar('Escolha um arquivo de imagem.', 'alerta');
        inputFoto.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = () => notificar('Não foi possível ler esta imagem.', 'erro');
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 360;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          novaFotoBase64 = canvas.toDataURL('image/jpeg', 0.82);

          if (previewFoto) {
            previewFoto.src = novaFotoBase64;
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      inputFoto.value = '';
    };
  }

  if (btnSalvar) {
    btnSalvar.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btnSalvar.disabled) return;

      const nome = document.getElementById('editNome')?.value?.trim().slice(0, 80);
      const telefone = document.getElementById('editTelefone')?.value?.trim().slice(0, 20);

      if (!nome || nome.length < 2) {
        notificar('Informe seu nome completo.', 'alerta');
        return;
      }

      // Só nome, telefone e foto: os dados do veículo não são enviados
      const payload = { nome, telefone };
      if (novaFotoBase64) {
        payload.foto_perfil_url = novaFotoBase64;
      }

      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando...';

      try {
        const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
          method: 'PUT',
          headers: obterHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));

        if (resp.ok) {
          notificar('Perfil atualizado com sucesso!', 'sucesso');
          if (data.aviso) notificar(data.aviso, 'alerta', 7000);
          fecharModal();
          await carregarPerfil();
        } else {
          notificar(data.erro || 'Não foi possível salvar os dados.', 'erro');
        }
      } catch (err) {
        notificar('Sem conexão. O perfil NÃO foi salvo.', 'erro');
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar Alterações';
      }
    };
  }
}