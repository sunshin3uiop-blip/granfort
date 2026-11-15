const fs = require('node:fs');
const readline = require('node:readline');
const { redis, key, hash } = require('../server/storage.cjs');

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file) throw new Error('Укажите путь к requests.jsonl.');
  if (args.includes('--production')) process.env.VERCEL_ENV = 'production';
  let added = 0;
  let skipped = 0;
  let duplicate = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const script = "if redis.call('SADD',KEYS[1],ARGV[1])==1 then redis.call('RPUSH',KEYS[2],ARGV[2]); return 1 else return 0 end";
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
      if (!row || !['date', 'name', 'phone', 'service'].every(field => typeof row[field] === 'string')) throw new Error();
    } catch {
      skipped++;
      continue;
    }
    const record = JSON.stringify({ date: row.date, name: row.name, phone: row.phone, service: row.service });
    const result = await redis(['EVAL', script, 2, key('imports'), key('requests'), hash(record), record]);
    if (result === 1) added++;
    else if (result === 0) duplicate++;
    else throw new Error('STORAGE_UNAVAILABLE');
  }
  console.log(`Добавлено: ${added}. Уже импортированы: ${duplicate}. Неверных строк: ${skipped}.`);
}

if (require.main === module) {
  main().catch(() => {
    console.error('Импорт не завершён. Проверьте путь к файлу и настройки Redis. Повторный запуск не удвоит уже импортированные строки.');
    process.exitCode = 1;
  });
}

module.exports = { main };
