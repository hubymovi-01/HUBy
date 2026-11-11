// js/motorista/motorista-perfil.js - Perfil do Motorista e Gestão de Modais
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { 
  obterCodigoAtivacaoMotorista, 
  definirCodigoAtivacaoMotorista, 
  falarTexto 
} from '../ia/motorista-ia.js';

export async function carregarPerfil() {
  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil`, {
      headers: obterHeaders()
    });

    if (!resp.ok) return null;
    const motorista = await resp.json();
    if (!motorista) return null;

    estado.motoristaId = motorista.id;
    estado.categoriaMotorista = motorista.categoria || 'carro';
    estado.statusAprovacaoAtual = motorista.status_aprovacao || 'aprovado';

    const inVoz = document.getElementById('drawerInputCodigoVoz');
    if (inVoz) {
      if (motorista.codigo_voz && motorista.codigo_voz.trim()) {
        localStorage.setItem('huby_codigo_voz_motorista', motorista.codigo_voz.trim());
        inVoz.value = motorista.codigo_voz.trim();
      } else {
        inVoz.value = obterCodigoAtivacaoMotorista();
      }
    }

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');

    if (topNome) topNome.textContent = motorista.nome || 'Carol';
    if (topNota) topNota.textContent = `⭐ ${Number(motorista.avaliacao || 5.0).toFixed(1)}`;
    if (topAvatar && motorista.foto_perfil_url) topAvatar.src = motorista.foto_perfil_url;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerCat = document.getElementById('drawerCategoriaBadge');
    const drawerNota = document.getElementById('drawerAvaliacaoTxt');
    const drawerFoto = document.getElementById('drawerFotoImg');

    if (drawerNome) drawerNome.textContent = motorista.nome || 'Carol';
    if (drawerCat) drawerCat.textContent = `HUBY ${(motorista.categoria || 'carro').toUpperCase()}`;
    if (drawerNota) drawerNota.textContent = `⭐ ${Number(motorista.avaliacao || 5.0).toFixed(1)}`;
    if (drawerFoto && motorista.foto_perfil_url) drawerFoto.src = motorista.foto_perfil_url;

    const drawerCarroModelo = document.getElementById('drawerCarroModelo');
    const drawerCarroDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerCarroPlaca = document.getElementById('drawerCarroPlaca');

    if (drawerCarroModelo) drawerCarroModelo.textContent = motorista.veiculo_modelo || 'Onix';
    if (drawerCarroDetalhes) drawerCarroDetalhes.textContent = `Cor: ${motorista.veiculo_cor || 'Prata'} • Ano: ${motorista.veiculo_ano || '2023'}`;
    if (drawerCarroPlaca) drawerCarroPlaca.textContent = (motorista.veiculo_placa || 'ABC1D23').toUpperCase();

    const saldoTxt = `R$ ${Number(motorista.saldo_carteira || 0).toFixed(2).replace('.', ',')}`;
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    const checkDinheiro = document.getElementById('chkAceitaDinheiro');
    const checkCartao = document.getElementById('chkAceitaCartao');
    const checkPix = document.getElementById('chkAceitaPix');

    if (checkDinheiro) checkDinheiro.checked = motorista.aceita_dinheiro !== false;
    if (checkCartao) checkCartao.checked = motorista.aceita_cartao !== false;
    if (checkPix) checkPix.checked = motorista.aceita_pix !== false;

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

  btnSalvar?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const novoComando = inputComando?.value?.trim();
    if (!novoComando) {
      notificar('Digite uma frase para ativar seu copiloto (ex: OK Gavião, Zanki).', 'alerta');
      inputComando?.focus();
      return;
    }

    const sucesso = await definirCodigoAtivacaoMotorista(novoComando);
    if (sucesso) {
      notificar(`Comando atualizado! Diga "${novoComando}" para falar com o app.`, 'sucesso');
    } else {
      notificar('Erro ao salvar comando.', 'erro');
    }
  });

  btnTestar?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const comandoAtual = inputComando?.value?.trim() || obterCodigoAtivacaoMotorista();
    falarTexto(`Copiloto pronto. Pode falar ${comandoAtual} seguido da ação que deseja.`);
  });
}

export function configurarSalvarPreferenciasPagto() {
  const btnSalvar = document.getElementById('btnSalvarPreferenciasPagto');
  if (!btnSalvar) return;

  btnSalvar.addEventListener('click', async (e) => {
    e.preventDefault();
    const aceita_dinheiro = document.getElementById('chkAceitaDinheiro')?.checked ?? true;
    const aceita_cartao = document.getElementById('chkAceitaCartao')?.checked ?? true;
    const aceita_pix = document.getElementById('chkAceitaPix')?.checked ?? true;

    if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
      notificar('Selecione ao menos uma forma de recebimento.', 'alerta');
      return;
    }

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
  });
}

export function configurarEdicaoPerfil() {
  const btnAbrir = document.getElementById('btnAbrirModalEdicaoPerfil');
  const modal = document.getElementById('modalEdicaoPerfil');
  const btnFechar = document.getElementById('btnFecharModalEdicao');
  const btnCancelar = document.getElementById('btnCancelarEdicao');
  const btnSalvar = document.getElementById('btnSalvarEdicaoPerfil');

  const inputFoto = document.getElementById('inputUploadFotoPerfil');
  const previewFoto = document.getElementById('previewFotoModal');

  btnAbrir?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (modal) {
      modal.style.display = 'flex';
      carregarPerfil();
    }
  });

  const fecharModal = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (modal) modal.style.display = 'none';
  };

  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);

  inputFoto?.addEventListener('change', () => {
    const file = inputFoto.files?.[0];
    if (file && previewFoto) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        previewFoto.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  btnSalvar?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const nome = document.getElementById('editNome')?.value?.trim();
    const telefone = document.getElementById('editTelefone')?.value?.trim();
    const veiculo_modelo = document.getElementById('editCarroModelo')?.value?.trim();
    const veiculo_placa = document.getElementById('editCarroPlaca')?.value?.trim();
    const veiculo_cor = document.getElementById('editCarroCor')?.value?.trim();
    const veiculo_ano = document.getElementById('editCarroAno')?.value?.trim();

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil/atualizar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({
          nome,
          telefone,
          veiculo_modelo,
          veiculo_placa,
          veiculo_cor,
          veiculo_ano
        })
      });

      if (resp.ok) {
        notificar('Perfil atualizado com sucesso!', 'sucesso');
        fecharModal();
        await carregarPerfil();
      } else {
        notificar('Não foi possível salvar os dados.', 'erro');
      }
    } catch (err) {
      notificar('Erro de conexão ao salvar perfil.', 'erro');
    }
  });
}