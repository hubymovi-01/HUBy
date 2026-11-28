// js/util/excluir-conta.js - "Excluir minha conta" (LGPD e exigência da Google Play)
// Coloca o botão logo abaixo do "Sair" (passageiro e motorista) e pede a senha para confirmar.
import { API_URL } from '../config.js';

const ID_BOTAO = 'btnExcluirMinhaConta';
const ID_MODAL = 'modalExcluirContaHUBy';

function estaLogado() {
  try {
    return Boolean(localStorage.getItem('huby_token'));
  } catch (e) {
    return false;
  }
}

function limparDadosDoAparelho() {
  // Conta excluída: apaga TUDO do HUBy neste aparelho (inclusive favoritos e endereços)
  try {
    const apagar = [];
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (chave && chave.indexOf('huby_') === 0) apagar.push(chave);
    }
    apagar.forEach((c) => localStorage.removeItem(c));
  } catch (e) {}
  try {
    const apagarSessao = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const chave = sessionStorage.key(i);
      if (chave && chave.indexOf('huby_') === 0) apagarSessao.push(chave);
    }
    apagarSessao.forEach((c) => sessionStorage.removeItem(c));
  } catch (e) {}
}

function criarElemento(tag, estilo, texto) {
  const el = document.createElement(tag);
  if (estilo) el.style.cssText = estilo;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function abrirModalExclusao() {
  document.getElementById(ID_MODAL)?.remove();

  const ehMotorista = String(localStorage.getItem('huby_user_role') || '').toLowerCase() === 'motorista';

  const fundo = criarElemento('div', 'position:fixed;inset:0;z-index:100100;background:rgba(6,10,18,0.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px;');
  fundo.id = ID_MODAL;

  const caixa = criarElemento('div', 'background:#111827;border:1.5px solid rgba(239,68,68,0.45);border-radius:18px;width:100%;max-width:380px;padding:20px;color:#E5E7EB;box-shadow:0 20px 50px rgba(0,0,0,0.8);');

  const titulo = criarElemento('h3', 'margin:0 0 8px;font-size:17px;font-weight:900;color:#F87171;', '⚠️ Excluir minha conta');
  const texto1 = criarElemento('p', 'margin:0 0 8px;font-size:13px;line-height:1.5;color:#CBD5E1;',
    'Seus dados pessoais (nome, e-mail, telefone, CPF, fotos' + (ehMotorista ? ', documentos, selfies e chave Pix' : '') + ') serão apagados. Isso não pode ser desfeito.');
  const texto2 = criarElemento('p', 'margin:0 0 14px;font-size:12px;line-height:1.5;color:#94A3B8;',
    'O histórico de viagens e pagamentos é mantido sem o seu nome, pelo prazo exigido por lei. Se quiser voltar depois, é só criar uma conta nova.');

  const rotulo = criarElemento('label', 'display:block;font-size:12px;font-weight:800;color:#CBD5E1;margin-bottom:6px;', 'Digite sua senha para confirmar');
  const campoSenha = criarElemento('input', 'width:100%;box-sizing:border-box;background:#0B0F19;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:12px;color:#FFF;font-size:14px;margin-bottom:10px;');
  campoSenha.type = 'password';
  campoSenha.autocomplete = 'current-password';
  campoSenha.maxLength = 72;
  campoSenha.id = 'campoSenhaExclusao';
  rotulo.htmlFor = campoSenha.id;

  const erro = criarElemento('div', 'display:none;font-size:12px;color:#F87171;background:rgba(239,68,68,0.12);border-radius:8px;padding:8px 10px;margin-bottom:10px;white-space:pre-line;');

  const linhaBotoes = criarElemento('div', 'display:flex;gap:8px;');
  const btnCancelar = criarElemento('button', 'flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);color:#CBD5E1;font-weight:800;padding:12px;border-radius:12px;font-size:13px;cursor:pointer;', 'Cancelar');
  const btnConfirmar = criarElemento('button', 'flex:1.4;background:#EF4444;border:none;color:#FFF;font-weight:900;padding:12px;border-radius:12px;font-size:13px;cursor:pointer;', 'Excluir definitivamente');
  btnCancelar.type = 'button';
  btnConfirmar.type = 'button';

  linhaBotoes.append(btnCancelar, btnConfirmar);
  caixa.append(titulo, texto1, texto2, rotulo, campoSenha, erro, linhaBotoes);
  fundo.appendChild(caixa);
  document.body.appendChild(fundo);
  setTimeout(() => campoSenha.focus(), 50);

  const fechar = () => fundo.remove();
  btnCancelar.addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });

  const mostrarErro = (msg) => {
    erro.textContent = String(msg || '').slice(0, 300);
    erro.style.display = 'block';
  };

  let enviando = false;
  const confirmar = async () => {
    if (enviando) return;
    const senha = campoSenha.value;
    if (!senha) return mostrarErro('Digite sua senha.');

    enviando = true;
    btnConfirmar.disabled = true;
    btnCancelar.disabled = true;
    btnConfirmar.textContent = 'Excluindo...';
    erro.style.display = 'none';

    try {
      const token = localStorage.getItem('huby_token') || '';
      const resp = await fetch(`${API_URL}/api/auth/excluir-conta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ senha })
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 429) throw new Error('Muitas tentativas. Aguarde alguns minutos.');
      if (!resp.ok) throw new Error(data.erro || 'Não foi possível excluir a conta agora.');

      limparDadosDoAparelho();
      caixa.replaceChildren(
        criarElemento('h3', 'margin:0 0 8px;font-size:17px;font-weight:900;color:#10B981;', '✅ Conta excluída'),
        criarElemento('p', 'margin:0;font-size:13px;line-height:1.5;color:#CBD5E1;', data.mensagem || 'Sua conta foi excluída. Obrigado por ter usado o HUBy.')
      );
      setTimeout(() => window.location.replace('./welcome.html'), 2500);
    } catch (err) {
      mostrarErro(err.message);
      enviando = false;
      btnConfirmar.disabled = false;
      btnCancelar.disabled = false;
      btnConfirmar.textContent = 'Excluir definitivamente';
    }
  };

  btnConfirmar.addEventListener('click', confirmar);
  campoSenha.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmar(); });
}

function colocarBotao() {
  if (document.getElementById(ID_BOTAO)) {
    document.getElementById(ID_BOTAO).style.display = estaLogado() ? 'block' : 'none';
    return;
  }

  // Passageiro: botão "Sair ou Mudar de Conta" | Motorista: botão "Encerrar Sessão / Sair"
  const ancora = document.getElementById('btnAcaoConta') || document.getElementById('btnLogoutMotorista');
  if (!ancora || !ancora.parentNode) return;

  const btn = criarElemento('button', 'display:' + (estaLogado() ? 'block' : 'none') + ';width:100%;margin-top:10px;background:none;border:none;color:#F87171;font-size:12px;font-weight:700;text-decoration:underline;cursor:pointer;padding:8px;', 'Excluir minha conta');
  btn.type = 'button';
  btn.id = ID_BOTAO;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!estaLogado()) return;
    abrirModalExclusao();
  });

  ancora.parentNode.insertBefore(btn, ancora.nextSibling);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', colocarBotao);
} else {
  colocarBotao();
}
// O menu do passageiro muda depois do login; confere de novo quando a pessoa volta para a tela
window.addEventListener('focus', colocarBotao);