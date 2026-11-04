// js/motorista/motorista-perfil.js
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';

let fotoBase64Temporaria = null;

export async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/perfil`, { headers: obterHeaders() });
    if (!res.ok) return;
    const m = await res.json();

    if (m.id) {
      estado.motoristaId = m.id;
      estado.motoristaNome = m.nome || 'Carol';
      estado.dadosMotorista = m;
      localStorage.setItem('huby_motorista_id', m.id);
    }

    // Carrega preferências de pagamento
    estado.aceitaDinheiro = m.aceita_dinheiro !== false;
    estado.aceitaCartao = m.aceita_cartao !== false;
    estado.aceitaPix = m.aceita_pix !== false;

    const chkDinheiro = document.getElementById('chkAceitaDinheiro');
    const chkCartao = document.getElementById('chkAceitaCartao');
    const chkPix = document.getElementById('chkAceitaPix');

    if (chkDinheiro) chkDinheiro.checked = estado.aceitaDinheiro;
    if (chkCartao) chkCartao.checked = estado.aceitaCartao;
    if (chkPix) chkPix.checked = estado.aceitaPix;

    // Header superior
    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    if (topNome) topNome.textContent = (m.nome || 'Carol').split(' ')[0];
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    // Saldo
    estado.saldoCarteira = Number(m.saldo_carteira || 0);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    // Drawer lateral
    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerFoto = document.getElementById('drawerFotoImg');
    const drawerAvaliacao = document.getElementById('drawerAvaliacaoTxt');
    const drawerTotalViagens = document.getElementById('drawerTotalViagensTxt');
    const inputPixDrawer = document.getElementById('drawerInputChavePix');

    if (drawerNome) drawerNome.textContent = m.nome || 'Carol';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'ABC1D23').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Onix';
    if (drawerDetalhes) {
      drawerDetalhes.textContent = `Cor: ${m.veiculo_cor || 'Prata'} • Ano: ${m.veiculo_ano || '2023'}`;
    }
    if (drawerFoto && m.foto_perfil_url) drawerFoto.src = m.foto_perfil_url;
    if (drawerAvaliacao) drawerAvaliacao.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (drawerTotalViagens) drawerTotalViagens.textContent = `${m.total_corridas || 0} viagens`;

    if (inputPixDrawer && m.chave_pix_padrao) {
      inputPixDrawer.value = m.chave_pix_padrao;
    }

    sincronizarExtratoDiario();
  } catch (e) {
    console.warn('Erro ao carregar perfil do condutor:', e);
  }
}

export function configurarEdicaoPerfil() {
  const btnAbrirModal = document.getElementById('btnAbrirModalEdicaoPerfil');
  const modal = document.getElementById('modalEdicaoPerfil');
  const btnFechar = document.getElementById('btnFecharModalEdicao');
  const btnCancelar = document.getElementById('btnCancelarEdicao');
  const btnSalvar = document.getElementById('btnSalvarEdicaoPerfil');
  const inputFoto = document.getElementById('inputUploadFotoPerfil');
  const imgPrevia = document.getElementById('previewFotoModal');

  const abrirModal = () => {
    if (!modal) return;
    const m = estado.dadosMotorista || {};

    const inpNome = document.getElementById('editNome');
    const inpTel = document.getElementById('editTelefone');
    const inpMod = document.getElementById('editCarroModelo');
    const inpPlaca = document.getElementById('editCarroPlaca');
    const inpCor = document.getElementById('editCarroCor');
    const inpAno = document.getElementById('editCarroAno');

    if (inpNome) inpNome.value = m.nome || estado.motoristaNome || '';
    if (inpTel) inpTel.value = m.telefone || '';
    if (inpMod) inpMod.value = m.veiculo_modelo || '';
    if (inpPlaca) inpPlaca.value = m.veiculo_placa || '';
    if (inpCor) inpCor.value = m.veiculo_cor || '';
    if (inpAno) inpAno.value = m.veiculo_ano || '';

    if (imgPrevia && m.foto_perfil_url) {
      imgPrevia.src = m.foto_perfil_url;
    }

    fotoBase64Temporaria = null;
    modal.style.display = 'flex';
  };

  const fecharModal = () => {
    if (modal) modal.style.display = 'none';
  };

  btnAbrirModal?.addEventListener('click', abrirModal);
  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  inputFoto?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem selecionada é muito pesada (máx 5MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      fotoBase64Temporaria = ev.target.result;
      if (imgPrevia) imgPrevia.src = fotoBase64Temporaria;
    };
    reader.readAsDataURL(file);
  });

  btnSalvar?.addEventListener('click', async () => {
    const nome = document.getElementById('editNome')?.value?.trim();
    const telefone = document.getElementById('editTelefone')?.value?.trim();
    const veiculo_modelo = document.getElementById('editCarroModelo')?.value?.trim();
    const veiculo_placa = document.getElementById('editCarroPlaca')?.value?.trim();
    const veiculo_cor = document.getElementById('editCarroCor')?.value?.trim();
    const veiculo_ano = document.getElementById('editCarroAno')?.value?.trim();

    if (!nome) {
      alert('O nome completo é obrigatório.');
      return;
    }

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';

    try {
      const payload = {
        nome,
        telefone,
        veiculo_modelo,
        veiculo_placa: veiculo_placa ? veiculo_placa.toUpperCase() : 'ABC1D23',
        veiculo_cor,
        veiculo_ano: veiculo_ano ? Number(veiculo_ano) : null
      };

      if (fotoBase64Temporaria) {
        payload.foto_base64 = fotoBase64Temporaria;
      }

      const res = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Erro ao salvar alterações do perfil.');

      alert('✅ Dados do condutor atualizados com sucesso!');
      fecharModal();
      carregarPerfil();
    } catch (err) {
      alert(err.message);
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar Alterações';
    }
  });

  const btnSalvarPix = document.getElementById('btnSalvarChavePix');
  btnSalvarPix?.addEventListener('click', async () => {
    const chave = document.getElementById('drawerInputChavePix')?.value?.trim();
    if (!chave) {
      alert('Informe uma chave Pix válida.');
      return;
    }

    btnSalvarPix.disabled = true;
    btnSalvarPix.textContent = '...';

    try {
      const res = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ chave_pix_padrao: chave })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar chave Pix.');
      alert('✅ Chave Pix padrão salva com sucesso!');
    } catch (err) {
      alert(err.message);
    } finally {
      btnSalvarPix.disabled = false;
      btnSalvarPix.textContent = 'Salvar';
    }
  });
}

export function configurarSalvarPreferenciasPagto() {
  const btn = document.getElementById('btnSalvarPreferenciasPagto');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const chkDinheiro = document.getElementById('chkAceitaDinheiro');
    const chkCartao = document.getElementById('chkAceitaCartao');
    const chkPix = document.getElementById('chkAceitaPix');

    const aceita_dinheiro = !!chkDinheiro?.checked;
    const aceita_cartao = !!chkCartao?.checked;
    const aceita_pix = !!chkPix?.checked;

    if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
      alert('Selecione pelo menos uma forma de pagamento para trabalhar.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      const res = await fetch(`${API_URL}/api/pedidos/motoristas/preferencias-pagamento`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ aceita_dinheiro, aceita_cartao, aceita_pix })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao salvar preferências.');

      estado.aceitaDinheiro = aceita_dinheiro;
      estado.aceitaCartao = aceita_cartao;
      estado.aceitaPix = aceita_pix;

      alert('✅ Preferências de pagamento salvas com sucesso!');
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar Preferências';
    }
  });
}

export async function sincronizarExtratoDiario() {
  const containerExtrato = document.getElementById('drawerListaExtrato');
  const lblGanhosHoje = document.getElementById('lblGanhosHojeValor');
  const lblViagensHoje = document.getElementById('lblCorridasHojeQtd');

  try {
    const res = await fetch(`${API_URL}/api/motoristas/extrato`, { headers: obterHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const corridas = data.corridas || data.historico || [];

    let totalGanhos = 0;
    let qtdViagens = 0;

    if (corridas.length && containerExtrato) {
      containerExtrato.innerHTML = corridas.map(c => {
        const repasse = Number(c.repasse_liquido || (c.valor_total * 0.85));
        totalGanhos += repasse;
        qtdViagens++;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-dark); font-size: 12px;">
            <div style="max-width: 65%;">
              <div style="color: #FFF; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${c.destino_endereco || 'Viagem Concluída'}
              </div>
              <small style="color: var(--text-sec); font-size: 10px;">${new Date(c.criado_em || c.concluido_em).toLocaleDateString('pt-BR')}</small>
            </div>
            <strong style="color: var(--emerald);">+ R$ ${repasse.toFixed(2).replace('.', ',')}</strong>
          </div>
        `;
      }).join('');
    }

    if (lblGanhosHoje) lblGanhosHoje.textContent = `R$ ${totalGanhos.toFixed(2).replace('.', ',')}`;
    if (lblViagensHoje) lblViagensHoje.textContent = `${qtdViagens} viagens`;
  } catch (e) { }
}