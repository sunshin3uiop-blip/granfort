const { createHash } = require('node:crypto');

function storageConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('STORAGE_NOT_CONFIGURED');
  const address = new URL(url);
  if (address.protocol !== 'https:' && (process.env.VERCEL || !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname))) {
    throw new Error('STORAGE_NOT_CONFIGURED');
  }
  return { url: address.href, token };
}

async function redis(command) {
  const { url, token } = storageConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('STORAGE_UNAVAILABLE');
  const data = await response.json();
  if (data.error || !Object.hasOwn(data, 'result')) throw new Error('STORAGE_UNAVAILABLE');
  return data.result;
}

function key(name) {
  const prefix = process.env.GRANFORT_STORAGE_PREFIX || 'granfort';
  const environment = process.env.VERCEL_ENV || 'development';
  return `${prefix}:${environment}:${name}`;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function rateAllowed(req, group, limit, seconds) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  // Счётчик и время его жизни устанавливаются одной командой Redis.
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
  const count = await redis(['EVAL', script, 1, key(`rate:${group}:${hash(ip)}`), seconds]);
  if (!Number.isSafeInteger(count)) throw new Error('STORAGE_UNAVAILABLE');
  return count <= limit;
}

module.exports = { redis, key, hash, rateAllowed, storageConfig };
