import fs from 'fs';
import sharp from 'sharp';

const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="100" fill="#0B0F19"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-weight="900" font-size="130" fill="#FFFFFF">
    HUB<tspan fill="#10B981">y</tspan>
  </text>
</svg>
`;

// Garante que a pasta img/ existe
if (!fs.existsSync('img')) {
  fs.mkdirSync('img', { recursive: true });
}

fs.writeFileSync('img/icon.svg', svgIcon.trim());
console.log('✅ SVG base criado em img/icon.svg');

const svgBuffer = Buffer.from(svgIcon);

// Gera icon-192.png
await sharp(svgBuffer)
  .resize(192, 192)
  .png()
  .toFile('img/icon-192.png');
console.log('✅ img/icon-192.png gerado com sucesso!');

// Gera icon-512.png
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile('img/icon-512.png');
console.log('✅ img/icon-512.png gerado com sucesso!');