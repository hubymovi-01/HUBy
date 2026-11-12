// js/motorista/motorista-perfil.js - Perfil do Motorista, Foto Base64 e Sincronização de Estado
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { carregarGanhosHoje, carregarExtratoFinanceiro } from './motorista-ganhos.js';
import { 
  obterCodigoAtivacaoMotorista, 
  definirCodigoAtivacaoMotorista, 
  falarTexto 
} from '../ia/motorista-ia.js';

export async function carregarPerfil() {
  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });

    if (!resp.ok) return null;
    const motorista = await resp.json();
    if (!motorista) return null;

    // Sincroniza todas as propriedades com motorista-estado.js
    estado.motoristaId = motorista.id;
    estado.motoristaNome = motorista.nome || 'Carol';
    estado.categoriaMotorista = motorista.categoria || 'carro';
    estado.statusAprovacaoAtual = motorista.status_aprovacao || 'aprovado';
    estado.saldoCarteira = Number(motorista.saldo_carteira || 0);
    estado.aceitaDinheiro = motorista.aceita_dinheiro !== false;
    estado.aceitaCartao = motorista.aceita_cartao !== false;
    estado.aceitaPix = motorista.aceita_pix !== false;
    estado.dadosMotorista = motorista;

    const inVoz = document.getElementById('drawerInputCodigoVoz');
    if (inVoz) {
      if (motorista.codigo_voz && motorista.codigo_voz.trim()) {
        localStorage.setItem('huby_codigo_voz_motorista', motorista.codigo_voz.trim());
        inVoz.value = motorista.codigo_voz.trim();
      } else {
        inVoz.value = obterCodigoAtivacaoMotorista();
      }
    }

    const avaliacaoVal = Number(motorista.avaliacao_media || motorista.avaliacao || 5.0).toFixed(1);
    const totalCorridasVal = Number(motorista.total_corridas || 0);

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');

    if (topNome) topNome.textContent = motorista.nome || 'Carol';
    if (topNota) topNota.textContent = `⭐ ${avaliacaoVal}`;
    if (topAvatar && motorista.foto_perfil_url) topAvatar.src = motorista.foto_perfil_url;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerCat = document.getElementById('drawerCategoriaBadge');
    const drawerNota = document.getElementById('drawerAvaliacaoTxt');
    const drawerViagens = document.getElementById('drawerTotalViagensTxt');
    const drawerFoto = document.getElementById('drawerFotoImg');

    if (drawerNome) drawerNome.textContent = motorista.nome || 'Carol';
    if (drawerCat) drawerCat.textContent = `HUBY ${(motorista.categoria || 'carro').toUpperCase()}`;
    if (drawerNota) drawerNota.textContent = `⭐ ${avaliacaoVal}`;
    if (drawerViagens) drawerViagens.textContent = `${totalCorridasVal} viagens`;
    if (drawerFoto && motorista.foto_perfil_url) drawerFoto.src = motorista.foto_perfil_url;

    const drawerCarroModelo = document.getElementById('drawerCarroModelo');
    const drawerCarroDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerCarroPlaca = document.getElementById('drawerCarroPlaca');

    if (drawerCarroModelo) drawerCarroModelo.textContent = motorista.veiculo_modelo || 'Onix';
    if (drawerCarroDetalhes) drawerCarroDetalhes.textContent = `Cor: ${motorista.veiculo_cor || 'Prata'} • Ano: ${motorista.veiculo_ano || '2023'}`;
    if (drawerCarroPlaca) drawerCarroPlaca.textContent = (motorista.veiculo_placa || 'ABC1D23').toUpperCase();

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

    const inputPixDrawer = document.getElementById('drawerInputChavePix');
    if (inputPixDrawer && motorista.chave_pix_padrao) {
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
    if (prevFoto && motorista.foto_perfil_url) prevFoto.src = motorista.foto_perfil_url;

    // Atualiza também o card de Ganhos de Hoje e o Extrato Lateral
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

      const novoComando = inputComando?.value?.trim();
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

export function configurarSalvarPreferenciasPagto() {
  const btnSalvar = document.getElementById('btnSalvarPreferenciasPagto');
  if (!btnSalvar) return;

  btnSalvar.onclick = async (e) => {
    e.preventDefault();
    const aceita_dinheiro = document.getElementById('chkAceitaDinheiro')?.checked ?? true;
    const aceita_cartao = document.getElementById('chkAceitaCartao')?.checked ?? true;
    const aceita_pix = document.getElementById('chkAceitaPix')?.checked ?? true;

    if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
      notificar('Selecione ao menos uma forma de recebimento.', 'alerta');
      return;
    }

    estado.aceitaDinheiro = aceita_dinheiro;
    estado.aceitaCartao = aceita_cartao;
    estado.aceitaPix = aceita_pix;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/motoristas/preferencias-pagamento`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ aceita_dinheiro, aceita_cartao, aceita_pix })
      });

      if (resp.ok) {
        notificar('Preferências de pagamento salvas!', 'sucesso');
      } else {
        notificar('Erro ao salvar preferências.', 'erro');
      }
    } catch (err) {
      notificar('Falha de conexão ao salvar preferências.', 'erro');
    }
  };
}

export function configurarEdicaoPerfil() {
  const btnAbrir = document.getElementById('btnAbrirModalEdicaoPerfil');
  const modal = document.getElementById('modalEdicaoPerfil');
  const btnFechar = document.getElementById('btnFecharModalEdicao');
  const btnCancelar = document.getElementById('btnCancelarEdicao');
  const btnSalvar = document.getElementById('btnSalvarEdicaoPerfil');

  const inputFoto = document.getElementById('inputUploadFotoPerfil');
  const previewFoto = document.getElementById('previewFotoModal');

  let novaFotoBase64 = null;

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

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
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
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
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
    };
  }

  if (btnSalvar) {
    btnSalvar.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const nome = document.getElementById('editNome')?.value?.trim();
      const telefone = document.getElementById('editTelefone')?.value?.trim();
      const veiculo_modelo = document.getElementById('editCarroModelo')?.value?.trim();
      const veiculo_placa = document.getElementById('editCarroPlaca')?.value?.trim();
      const veiculo_cor = document.getElementById('editCarroCor')?.value?.trim();
      const veiculo_ano = document.getElementById('editCarroAno')?.value?.trim();

      const payload = {
        nome,
        telefone,
        veiculo_modelo,
        veiculo_placa,
        veiculo_cor,
        veiculo_ano
      };

      if (novaFotoBase64) {
        payload.foto_perfil_url = novaFotoBase64;
        payload.foto_base64 = novaFotoBase64;
      }

      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando...';

      try {
        const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
          method: 'PUT',
          headers: obterHeaders(),
          body: JSON.stringify(payload)
        });

        if (resp.ok) {
          const fotoSalva = novaFotoBase64;
          notificar('Perfil e foto atualizados com sucesso!', 'sucesso');
          fecharModal();
          await carregarPerfil();

          if (fotoSalva) {
            const topAvatar = document.getElementById('topAvatarImg');
            const drawerFoto = document.getElementById('drawerFotoImg');
            if (topAvatar) topAvatar.src = fotoSalva;
            if (drawerFoto) drawerFoto.src = fotoSalva;
          }
        } else {
          notificar('Não foi possível salvar os dados.', 'erro');
        }
      } catch (err) {
        notificar('Erro de conexão ao salvar perfil.', 'erro');
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar Alterações';
      }
    };
  }
}