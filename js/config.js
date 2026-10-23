/**
 * HUBy 2.0 - Configurações Gerais e Tarifas Dinâmicas (js/config.js)
 */

export const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

// Tarifas de contingência (fallback caso a rede falhe)
export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 6.5, km: 2.2, min: 10 },
  moto: { id: 'moto', tipo: 'carro', nome: 'HUBy Moto', icone: '🏍️', base: 4.0, km: 1.5, min: 7 },
  flash_moto: { id: 'flash_moto', tipo: 'flash', nome: 'Flash Moto', icone: '📦', base: 5.0, km: 1.8, min: 8 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo', nome: 'Picape Frete', icone: '🛻', base: 35.0, km: 4.5, min: 45 }
};

export let MULTIPLICADOR_PICO = 1.0;

// Sincroniza em tempo real com as tarifas configuradas pelo dono no painel
export async function sincronizarTarifasServidor() {
  try {
    const resp = await fetch(`${API_URL}/api/config/tarifas`);
    if (!resp.ok) return;
    const dados = await resp.json();

    if (dados.carro) CATEGORIAS.carro = { ...CATEGORIAS.carro, ...dados.carro };
    if (dados.moto) CATEGORIAS.moto = { ...CATEGORIAS.moto, ...dados.moto };
    if (dados.flash_moto) CATEGORIAS.flash_moto = { ...CATEGORIAS.flash_moto, ...dados.flash_moto };
    if (dados.cargo_pickup) CATEGORIAS.cargo_pickup = { ...CATEGORIAS.cargo_pickup, ...dados.cargo_pickup };
    if (dados.multiplicador_pico) MULTIPLICADOR_PICO = Number(dados.multiplicador_pico) || 1.0;
  } catch (err) {
    console.warn('Utilizando tabela de tarifas local de reserva:', err.message);
  }
}

// Algoritmo de Cálculo Dinâmico com Multiplicador de Pico/Chuva
export function calcularPreco(catId, distanciaKm) {
  const cat = CATEGORIAS[catId] || CATEGORIAS.carro;
  const dist = Math.max(0.5, Number(distanciaKm) || 1.5);
  
  // Fórmula base: Max(Mínimo, Base + Km) * Multiplicador
  const valorBaseCalculado = Math.max(cat.min, cat.base + (dist * cat.km));
  const valorFinal = Number((valorBaseCalculado * MULTIPLICADOR_PICO).toFixed(2));

  return {
    categoria: cat.nome,
    tipo: cat.tipo,
    valorTotal: valorFinal,
    multiplicador: MULTIPLICADOR_PICO,
    formatado: `R$ ${valorFinal.toFixed(2).replace('.', ',')}`
  };
}