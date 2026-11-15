// Vercel публикует отдельно подготовленную папку со статическими файлами.
// PHP-файлы выполняются на PHP-сервере, поэтому исходники сюда не копируем.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist');
const output = path.join(root, 'vercel-public');
const publicExtensions = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.ttf', '.woff', '.woff2']);

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, {
  recursive: true,
  filter: file => {
    const name = path.basename(file);
    if (name.startsWith('.')) return false;
    if (fs.statSync(file).isDirectory()) return !['data', 'server', 'api', 'node_modules'].includes(name);
    return publicExtensions.has(path.extname(file).toLowerCase());
  }
});

if (!fs.existsSync(path.join(output, 'index.html'))) {
  throw new Error('В папке dist не найден index.html.');
}

console.log('Статика подготовлена в vercel-public. Обработчики Vercel находятся в api.');
