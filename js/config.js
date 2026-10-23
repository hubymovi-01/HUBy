/**
 * HUBy 2.0 - Configurações de Tarifas e Categorias (js/config.js)
 */

// js/config.js
export const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

export const CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 6.5, km: 2.2, min: 10 },
  moto: { id: 'moto', tipo: 'carro', nome: 'HUBy Moto', icone: '🏍️', base: 4.0, km: 1.5, min: 7 },
  flash_moto: { id: 'flash_moto', tipo: 'flash', nome: 'Flash Moto', icone: '📦', base: 5.0, km: 1.8, min: 8 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo', nome: 'Picape Frete', icone: '🛻', base: 35.0, km: 4.5, min: 45 }
};

export function calcularPreco(catId, distanciaKm) {
  const cat = CATEGORIAS[catId] || CATEGORIAS.carro;
  const dist = Math.max(0.5, Number(distanciaKm) || 1.5);
  const total = Math.max(cat.min, cat.base + (dist * cat.km));
  return {
    categoria: cat.nome,
    tipo: cat.tipo,
    valorTotal: Number(total.toFixed(2)),
    formatado: `R$ ${total.toFixed(2).replace('.', ',')}`
  };
}