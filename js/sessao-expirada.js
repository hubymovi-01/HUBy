// js/sessao-expirada.js - Login vencido ou inválido: sai da conta e abre a tela de login
// Carregado ANTES dos outros scripts nas páginas index, motorista e admin.
(function () {
  if (window.__hubySessaoGuard) return;
  window.__hubySessaoGuard = true;

  // Na tela de login e de cadastro não faz nada (senha errada lá é normal)
  var pagina = (location.pathname.split('/').pop() || '').toLowerCase();
  if (pagina === 'login.html' || pagina === 'cadastro.html') return;

  // Dados que continuam salvos ao sair (favoritos, endereços, meta, agenda, IA, região)
  var MANTER = /^huby_(meta_diaria|endereco_|coords_|mot_casa_nome|ia_|regiao|meus_agendamentos|tipo_acesso)/;
  var redirecionando = false;

  function pedidoTinhaLogin(init) {
    var h = init && init.headers;
    if (!h) return false;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        return /^Bearer\s+\S+/i.test(h.get('Authorization') || '');
      }
      if (Array.isArray(h)) {
        return h.some(function (par) {
          return String(par[0]).toLowerCase() === 'authorization' && /^Bearer\s+\S+/i.test(String(par[1] || ''));
        });
      }
      var valor = h.Authorization || h.authorization || '';
      return /^Bearer\s+\S+/i.test(String(valor));
    } catch (e) {
      return false;
    }
  }

  function limparSessao() {
    try {
      var apagar = [];
      for (var i = 0; i < localStorage.length; i++) {
        var chave = localStorage.key(i);
        if (chave && chave.indexOf('huby_') === 0 && !MANTER.test(chave)) apagar.push(chave);
      }
      apagar.forEach(function (c) { localStorage.removeItem(c); });
    } catch (e) {}
  }

  function sessaoExpirou() {
    if (redirecionando) return;
    redirecionando = true;
    limparSessao();
    try { sessionStorage.setItem('huby_aviso_login', 'Sua sessão expirou. Entre novamente.'); } catch (e) {}
    var perfilLogin = pagina === 'motorista.html' ? 'motorista' : 'cliente';
    location.replace('./login.html?perfil=' + perfilLogin + '&expirou=1');  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal !== 'function') return;

  window.fetch = function (entrada, init) {
    var comLogin = pedidoTinhaLogin(init);
    var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    return fetchOriginal.apply(this, arguments).then(function (resp) {
      if (resp && resp.status === 401 && comLogin && url.indexOf('/api/') !== -1) {
        sessaoExpirou();
      }
      return resp;
    });
  };
})();