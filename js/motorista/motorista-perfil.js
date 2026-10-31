// js/motorista/motorista-perfil.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { carregarExtratoFinanceiro } from './motorista-ganhos.js';

export function configurarDrawerPerfil() {
  const btnAbrir = document.getElementById('btnAbrirDrawerPerfil');
  const btnFechar = document.getElementById('btnFecharDrawerPerfil');
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('driverDrawer');
  const btnSalvarPix = document.getElementById('btnSalvarChavePix');
  const btnLogout = document.getElementById('btnLogoutMotorista');

  // Elementos do Modal de Edição
  const modalEdicao = document.getElementById('modalEdicaoPerfil');
  const btnAbrirEdicao = document.getElementById('btnAbrirModalEdicaoPerfil');
  const btnFecharEdicao = document.getElementById('btnFecharModalEdicao');
  const btnCancelarEdicao = document.getElementById('btnCancelarEdicao');
  const btnSalvarEdicao = document.getElementById('btnSalvarEdicaoPerfil');
  const inputUploadFoto = document.getElementById('inputUploadFotoPerfil');
  const previewFotoModal = document.getElementById('previewFotoModal');

  const abrir = () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
    carregarExtratoFinanceiro();
  };

  const fechar = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };

  btnAbrir?.addEventListener('click', abrir);
  btnFechar?.addEventListener('click', fechar);
  overlay?.addEventListener('click', fechar);

  // Leitor e compressor de foto (Câmera ou Galeria)
  inputUploadFoto?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        estado.novaFotoBase64Temp = canvas.toDataURL('image/jpeg', 0.82);

        if (previewFotoModal) {
          previewFotoModal.src = estado.novaFotoBase64Temp;
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Abertura do modal preenchendo os dados existentes
  btnAbrirEdicao?.addEventListener('click', () => {
    if (!modalEdicao) return;
    estado.novaFotoBase64Temp = null;

    if (previewFotoModal) {
      previewFotoModal.src = estado.dadosMotorista?.foto_perfil_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80';
    }

    document.getElementById('editNome').value = estado.dadosMotorista?.nome || '';
    document.getElementById('editTelefone').value = estado.dadosMotorista?.telefone || '';
    document.getElementById('editCarroModelo').value = estado.dadosMotorista?.veiculo_modelo || '';
    document.getElementById('editCarroPlaca').value = estado.dadosMotorista?.veiculo_placa || '';
    document.getElementById('editCarroCor').value = estado.dadosMotorista?.veiculo_cor || '';
    document.getElementById('editCarroAno').value = estado.dadosMotorista?.veiculo_ano || '';

    modalEdicao.style.display = 'flex';
  });

  const fecharModalEdicao = () => {
    if (modalEdicao) modalEdicao.style.display = 'none';
  };

  btnFecharEdicao?.addEventListener('click', fecharModalEdicao);
  btnCancelarEdicao?.addEventListener('click', fecharModalEdicao);

  // Guardar alterações do perfil
  btnSalvarEdicao?.addEventListener('click', async () => {
    const token = localStorage.getItem('huby_token');
    const nome = document.getElementById('editNome')?.value.trim();
    const telefone = document.getElementById('editTelefone')?.value.trim();
    const veiculo_modelo = document.getElementById('editCarroModelo')?.value.trim();
    const veiculo_placa = document.getElementById('editCarroPlaca')?.value.trim().toUpperCase();
    const veiculo_cor = document.getElementById('editCarroCor')?.value.trim();
    const veiculo_ano = document.getElementById('editCarroAno')?.value.trim();

    try {
      btnSalvarEdicao.disabled = true;
      btnSalvarEdicao.textContent = 'Salvando...';

      const payload = {
        nome,
        telefone,
        veiculo_modelo,
        veiculo_placa,
        veiculo_cor,
        veiculo_ano
      };

      if (estado.novaFotoBase64Temp) {
        payload.foto_perfil_url = estado.novaFotoBase64Temp;
      }

      const resp = await fetch(`${API_URL}/api/motoristas/perfil`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const resultado = await resp.json().catch(() => ({}));

      if (resp.ok) {
        alert('Perfil profissional atualizado com sucesso!');
        fecharModalEdicao();
        await carregarPerfilCompleto();
      } else {
        alert(`Erro ao salvar: ${resultado.erro || 'Falha na requisição'}`);
      }
    } catch (e) {
      alert(`Falha de conexão: ${e.message}`);
    } finally {
      btnSalvarEdicao.disabled = false;
      btnSalvarEdicao.textContent = 'Salvar Alterações';
    }
  });

  // Salvar Chave Pix Padrão
  btnSalvarPix?.addEventListener('click', async () => {
    const chave_pix_padrao = document.getElementById('drawerInputChavePix')?.value.trim();
    if (!chave_pix_padrao) {
      alert('Informe uma chave Pix válida.');
      return;
    }

    const token = localStorage.getItem('huby_token');
    try {
      btnSalvarPix.disabled = true;
      btnSalvarPix.textContent = '...';

      const resp = await fetch(`${API_URL}/api/motoristas/perfil`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ chave_pix_padrao })
      });

      if (resp.ok) {
        alert('Chave Pix padrão atualizada com sucesso!');
        if (estado.dadosMotorista) estado.dadosMotorista.chave_pix_padrao = chave_pix_padrao;
      } else {
        alert('Erro ao atualizar chave Pix.');
      }
    } catch (e) {
      alert('Falha de conexão.');
    } finally {
      btnSalvarPix.disabled = false;
      btnSalvarPix.textContent = 'Salvar';
    }
  });

  btnLogout?.addEventListener('click', () => {
    if (confirm('Deseja realmente desconectar de sua conta?')) {
      localStorage.clear();
      window.location.replace('./login.html');
    }
  });
}

export async function carregarPerfilCompleto() {
  const token = localStorage.getItem('huby_token');
  try {
    const resp = await fetch(`${API_URL}/api/motoristas/perfil`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        localStorage.clear();
        window.location.replace('./login.html');
      }
      return;
    }

    const m = await resp.json();
    estado.dadosMotorista = m;
    estado.statusAprovacaoAtual = m.status_aprovacao || 'aprovado';
    estado.categoriaMotorista = m.categoria || 'carro';

    const saldoFormatado = `R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}`;

    // Topo
    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    if (topNome) topNome.textContent = m.nome ? m.nome.split(' ')[0] : 'Motorista';
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    // Saldo no Dock Inferior
    const saldoEl = document.getElementById('saldoCarteiraValor');
    if (saldoEl) saldoEl.textContent = saldoFormatado;

    // Drawer Lateral
    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerCategoria = document.getElementById('drawerCategoriaBadge');
    const drawerFoto = document.getElementById('drawerFotoImg');
    const drawerNota = document.getElementById('drawerAvaliacaoTxt');
    const drawerViagens = document.getElementById('drawerTotalViagensTxt');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerSaldo = document.getElementById('drawerSaldoValor');
    const inputPix = document.getElementById('drawerInputChavePix');

    if (drawerNome) drawerNome.textContent = m.nome || 'Condutor Parceiro';
    if (drawerCategoria) drawerCategoria.textContent = `HUBY ${(m.categoria || 'CARRO').toUpperCase()}`;
    if (drawerFoto && m.foto_perfil_url) drawerFoto.src = m.foto_perfil_url;
    if (drawerNota) drawerNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (drawerViagens) drawerViagens.textContent = `${m.total_corridas || 0} viagens`;

    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Veículo não informado';
    if (drawerDetalhes) {
      const corTxt = m.veiculo_cor || 'Cor não informada';
      const anoTxt = m.veiculo_ano || 'Ano não informado';
      drawerDetalhes.textContent = `${corTxt} • ${anoTxt}`;
    }
    if (drawerPlaca) drawerPlaca.textContent = m.veiculo_placa ? m.veiculo_placa.toUpperCase() : 'SEM PLACA';
    if (drawerSaldo) drawerSaldo.textContent = saldoFormatado;
    if (inputPix && m.chave_pix_padrao) inputPix.value = m.chave_pix_padrao;

    const saquePixIn = document.getElementById('saqueChavePix');
    if (saquePixIn && !saquePixIn.value && m.chave_pix_padrao) {
      saquePixIn.value = m.chave_pix_padrao;
    }
  } catch (err) {
    console.warn('Erro ao carregar perfil completo:', err);
  }
}

export function configurarModalSaquePix() {
  const modalSaque = document.getElementById('modalSaquePix');
  const btnAbrirSaque = document.getElementById('btnAbrirModalSaque');
  const btnFecharSaque = document.getElementById('btnFecharModalSaque');
  const btnConfirmarSaque = document.getElementById('btnConfirmarSaquePix');

  btnAbrirSaque?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'flex';
  });

  btnFecharSaque?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'none';
  });

  btnConfirmarSaque?.addEventListener('click', async () => {
    const token = localStorage.getItem('huby_token');
    const chavePix = document.getElementById('saqueChavePix')?.value.trim();
    const tipoChave = document.getElementById('saqueTipoChave')?.value || 'cpf';
    const valor = Number(document.getElementById('saqueValor')?.value);

    if (!chavePix || !valor || valor <= 0) {
      alert('Informe uma chave Pix válida e o valor desejado.');
      return;
    }

    try {
      btnConfirmarSaque.disabled = true;
      btnConfirmarSaque.textContent = 'Enviando...';

      const resp = await fetch(`${API_URL}/api/motoristas/saques`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ chavePix, tipoChave, valor })
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao solicitar saque.');

      alert('Solicitação de Saque Pix enviada com sucesso! Aguarde a liquidação.');
      if (modalSaque) modalSaque.style.display = 'none';

      const inValor = document.getElementById('saqueValor');
      if (inValor) inValor.value = '';

      await carregarPerfilCompleto();
      carregarExtratoFinanceiro();
    } catch (err) {
      alert(err.message);
    } finally {
      btnConfirmarSaque.disabled = false;
      btnConfirmarSaque.textContent = 'Confirmar Saque';
    }
  });
}