// Vercel публикует отдельно подготовленную папку со статическими файлами.
// PHP-файлы выполняются на PHP-сервере, поэтому исходники сюда не копируем.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist');
const output = path.join(root, 'vercel-public');

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, {
  recursive: true,
  filter: file => !file.toLowerCase().endsWith('.php')
});

if (!fs.existsSync(path.join(output, 'index.html'))) {
  throw new Error('В папке dist не найден index.html.');
}

console.log('Статическая часть сайта подготовлена в vercel-public. PHP-бэкенд требует отдельной настройки.');
