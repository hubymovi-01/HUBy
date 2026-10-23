import fs from 'fs';

// Função para gerar um PNG básico válido de 1x1 ou superior usando buffer ou SVG simples convertido
// Como alternativa rápida e sem dependências extras, gravamos os SVGs e criamos PNGs mínimos:
const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="100" fill="#0B0F19"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-weight="900" font-size="130" fill="#FFFFFF">
    HUB<tspan fill="#10B981">y</tspan>
  </text>
</svg>
`;

fs.writeFileSync('img/icon.svg', svgIcon.trim());
console.log('SVG base criado em img/icon.svg');