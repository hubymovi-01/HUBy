// js/motorista/motorista-loja.js - Módulo HUBy Clube / Loja
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';

let categoriaAtiva = 'todos';

export function configurarMarketplace() {
  const modal = document.getElementById('modalMarketplace');
  const btnTopo = document.getElementById('btnAbrirMarketplaceTopo');
  const btnDrawer = document.getElementById('btnAbrirMarketplaceDrawer');
  const btnFechar = document.getElementById('btnFecharMarketplace');
  const filtros = document.querySelectorAll('#filtrosMarketplace button');

  const abrir = () => {
    if (modal) {
      modal.style.display = 'flex';
      carregarItens(categoriaAtiva);
    }
  };

  const fechar = () => {
    if (modal) modal.style.display = 'none';
  };

  btnTopo?.addEventListener('click', abrir);
  btnDrawer?.addEventListener('click', () => {
    document.getElementById('driverDrawer')?.classList.remove('active');
    document.getElementById('drawerOverlay')?.classList.remove('active');
    abrir();
  });
  btnFechar?.addEventListener('click', fechar);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fechar();
  });

  filtros.forEach(btn => {
    btn.addEventListener('click', () => {
      filtros.forEach(b => {
        b.style.background = 'rgba(255,255,255,0.06)';
        b.style.borderColor = 'rgba(255,255,255,0.1)';
      });
      btn.style.background = 'rgba(139, 92, 246, 0.25)';
      btn.style.borderColor = '#8B5CF6';
      categoriaAtiva = btn.getAttribute('data-cat') || 'todos';
      carregarItens(categoriaAtiva);
    });
  });
}

async function carregarItens(categoria = 'todos') {
  const feed = document.getElementById('feedItensMarketplace');
  if (!feed) return;

  try {
    const res = await fetch(`${API_URL}/api/marketplace/itens?categoria=${encodeURIComponent(categoria)}`);
    if (!res.ok) throw new Error('Falha na requisição');
    const itens = await res.json();

    if (!itens.length) {
      feed.innerHTML = '<div style="text-align:center;color:#94A3B8;padding:20px;font-size:12px;">Nenhum parceiro encontrado nesta categoria.</div>';
      return;
    }

    feed.innerHTML = itens.map(item => {
      const msg = encodeURIComponent(`Olá! Sou parceiro HUBy (${estado.motoristaNome || 'Carol'}) e tenho interesse no benefício: "${item.titulo}".`);
      const link = `https://wa.me/${item.whatsapp_contato.replace(/\D/g, '')}?text=${msg}`;

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; margin-bottom: 10px;">
          ${item.imagem_url ? `
            <div style="height: 110px; width: 100%; position: relative;">
              <img src="${item.imagem_url}" alt="${item.titulo}" style="width: 100%; height: 100%; object-fit: cover;">
              <span style="position: absolute; top: 6px; right: 6px; background: #10B981; color: #022017; font-size: 10px; font-weight: 900; padding: 2px 7px; border-radius: 12px;">-${item.desconto_percentual}% OFF</span>
            </div>
          ` : ''}
          <div style="padding: 10px;">
            <strong style="color: #FFF; font-size: 13px; display: block;">${item.titulo}</strong>
            <small style="color: #C084FC; font-weight: 700; font-size: 11px;">🏢 ${item.empresa_nome}</small>
            <p style="color: #94A3B8; font-size: 11px; margin: 4px 0 8px;">${item.descricao}</p>
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
              <div>
                ${item.preco_original ? `<span style="color:#64748B;text-decoration:line-through;font-size:10px;display:block;">R$ ${Number(item.preco_original).toFixed(2).replace('.', ',')}</span>` : ''}
                <strong style="color: #10B981; font-size: 15px;">R$ ${Number(item.preco_parceiro).toFixed(2).replace('.', ',')}</strong>
              </div>
              <a href="${link}" target="_blank" style="background: #10B981; color: #022017; font-weight: 800; font-size: 11px; padding: 6px 10px; border-radius: 6px; text-decoration: none;">Chamar no Whats</a>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    feed.innerHTML = '<div style="text-align:center;color:#EF4444;padding:20px;font-size:12px;">Erro ao carregar ofertas.</div>';
  }
}