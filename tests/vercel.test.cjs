const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createApp } = require('../scripts/dev.cjs');
const requestHandler = require('../api/request.js');
const { key } = require('../server/storage.cjs');

// Отдельный REST-стенд с командами Redis, без подключения к Production.
const data = new Map();
let gateway;
let app;
let base;
let failure = '';
const password = 'test-only-admin-password-1234';
const envNames = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'ADMIN_PASSWORD', 'GRANFORT_STORAGE_PREFIX', 'VERCEL_ENV', 'VERCEL'];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));

function get(key) {
  const entry = data.get(key);
  if (entry?.expires !== undefined && entry.expires <= Date.now()) {
    data.delete(key);
    return undefined;
  }
  return entry?.value;
}

function list(key) {
  const value = get(key);
  if (value === undefined) { data.set(key, { value: [] }); return data.get(key).value; }
  if (!Array.isArray(value)) throw new Error('WRONGTYPE');
  return value;
}

function command(args) {
  const [action, first, ...rest] = args;
  if (action === 'GET') return get(first) ?? null;
  if (action === 'SET') {
    const [value, option, seconds] = rest;
    data.set(first, { value, ...(option === 'EX' ? { expires: Date.now() + Number(seconds) * 1000 } : {}) });
    return 'OK';
  }
  if (action === 'DEL') return data.delete(first) ? 1 : 0;
  if (action === 'RPUSH') return list(first).push(...rest);
  if (action === 'LLEN') return get(first) === undefined ? 0 : list(first).length;
  if (action === 'LRANGE') {
    const values = get(first) === undefined ? [] : list(first);
    let [start, stop] = rest.map(Number);
    start = Math.max(0, start < 0 ? values.length + start : start);
    stop = Math.min(values.length - 1, stop < 0 ? values.length + stop : stop);
    return stop < start ? [] : values.slice(start, stop + 1);
  }
  if (action === 'EVAL' && first.includes("'INCR'")) {
    const [, counterKey, seconds] = rest;
    const value = Number(get(counterKey) || 0) + 1;
    const old = data.get(counterKey);
    data.set(counterKey, { value: String(value), expires: value === 1 ? Date.now() + Number(seconds) * 1000 : old.expires });
    return value;
  }
  if (action === 'EVAL' && first.includes("'SADD'")) {
    const [, importKey, requestKey, id, record] = rest;
    if (!data.has(importKey)) data.set(importKey, { value: new Set() });
    const imported = get(importKey);
    if (imported.has(id)) return 0;
    imported.add(id);
    list(requestKey).push(record);
    return 1;
  }
  throw new Error('Unsupported test command');
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

before(async () => {
  require('../scripts/build-vercel.cjs');
  gateway = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-rest-token') {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (failure === 'http') { res.writeHead(503); return res.end('{}'); }
    if (failure === 'redis') return res.end(JSON.stringify({ error: 'test storage failure' }));
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = command(JSON.parse(Buffer.concat(chunks).toString()));
      res.end(JSON.stringify({ result }));
    } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: 'test command failure' }));
    }
  });
  process.env.UPSTASH_REDIS_REST_URL = await listen(gateway);
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-rest-token';
  delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

beforeEach(async () => {
  data.clear();
  failure = '';
  process.env.ADMIN_PASSWORD = password;
  process.env.GRANFORT_STORAGE_PREFIX = 'granfort-test';
  process.env.VERCEL_ENV = 'production';
  app = createApp();
  base = await listen(app);
});

afterEach(async () => { await close(app); });
after(async () => {
  await close(gateway);
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function jar() { return new Map(); }
async function call(url = '/admin.php', fields, cookies = jar(), headers = {}) {
  const response = await fetch(base + url, {
    method: fields === undefined ? 'GET' : 'POST',
    headers: { ...(fields !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), ...headers },
    body: fields === undefined ? undefined : new URLSearchParams(fields),
    redirect: 'manual'
  });
  for (const header of response.headers.getSetCookie()) {
    const first = header.split(';')[0];
    const at = first.indexOf('=');
    const name = first.slice(0, at);
    if (header.includes('Max-Age=0')) cookies.delete(name);
    else cookies.set(name, first.slice(at + 1));
  }
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function csrf(body) {
  const match = body.match(/name="token" value="([a-f0-9]+)"/);
  assert.ok(match, 'CSRF field must be present');
  return match[1];
}

async function login(cookies = jar()) {
  const page = await call('/admin.php', undefined, cookies);
  const result = await call('/admin.php', { action: 'login', token: csrf(page.body), password }, cookies);
  assert.equal(result.status, 303);
  return cookies;
}

const valid = { name: 'Тестовый пользователь', phone: '+7 (000) 000-00-00', service: 'Комплект защиты для JAC T9' };

test('static output serves the site and excludes server source, data and secrets', async () => {
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/index.html')).status, 200);
  assert.match((await call('/style.css')).headers.get('content-type'), /text\/css/);
  for (const url of ['/server/storage.cjs', '/.env', '/data/requests.jsonl', '/data/admin-password.hash', '/dist/admin.php']) {
    assert.equal((await call(url)).status, 404, url);
  }
  const config = JSON.parse(await fs.readFile(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(row => row.source === '/request.php' && row.destination === '/api/request'));
  assert.ok(config.rewrites.some(row => row.source === '/admin.php' && row.destination === '/api/admin'));
});

test('form validation and methods reject bad requests without storing records', async () => {
  assert.equal((await call('/request.php')).status, 405);
  for (const fields of [{}, { ...valid, name: 'А' }, { ...valid, name: 'А'.repeat(81) }, { ...valid, phone: '123' }, { ...valid, phone: 'телефон1234567890' }, { ...valid, service: 'unknown' }]) {
    assert.equal((await call('/request.php', fields)).status, 422);
  }
  assert.equal((await call('/request.php', valid, jar(), { Origin: 'https://other.example' })).status, 403);
  assert.equal((await call('/request.php', valid, jar(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const duplicate = await fetch(base + '/request.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=A&name=B&phone=123&service=x' });
  assert.equal(duplicate.status, 400); await duplicate.text();
  assert.equal(data.has(key('requests')), false);
});

test('valid form submissions append and remain available to a fresh app instance', async () => {
  assert.equal((await call('/request.php', valid, jar(), { Origin: base })).status, 201);
  assert.equal((await call('/request.php', { ...valid, name: 'Вторая заявка' })).status, 201);
  const rows = list(key('requests')).map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, valid.name);
  assert.match(rows[0].date, /^\d{4}-\d{2}-\d{2}T/);
  const cookies = await login();
  await close(app);
  app = createApp();
  base = await listen(app);
  const page = await call('/admin.php', undefined, cookies);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes(valid.name));
  assert.ok(page.body.indexOf('Вторая заявка') < page.body.indexOf(valid.name));
});

test('Vercel parsed body and malformed JSON getter contracts are supported', async () => {
  function response() {
    return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
  }
  const req = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: valid };
  const res = response();
  await requestHandler(req, res);
  assert.equal(res.statusCode, 201);
  const invalid = { method: 'POST', headers: { 'content-type': 'application/json' }, get body() { throw new Error('malformed body'); } };
  const bad = response();
  await requestHandler(invalid, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(list(key('requests')).length, 1);
});

test('JSON array fields and oversized bodies are rejected', async () => {
  for (const fields of [{ ...valid, name: ['bad'] }, { ...valid, phone: {} }, { ...valid, service: null }]) {
    const result = await fetch(base + '/request.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    assert.equal(result.status, 422); await result.text();
  }
  const result = await fetch(base + '/request.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a'.repeat(9000) }) });
  assert.equal(result.status, 400); await result.text();
  assert.equal(data.has(key('requests')), false);
});

test('missing storage and provider failures never report a successful save', async () => {
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal((await call('/request.php', valid)).status, 503);
  assert.equal((await call('/admin.php')).status, 503);
  process.env.UPSTASH_REDIS_REST_TOKEN = token;
  for (const mode of ['http', 'redis']) {
    failure = mode;
    const result = await call('/request.php', valid);
    assert.equal(result.status, 503);
    assert.ok(!result.body.includes('Заявка сохранена'));
    assert.ok(!result.body.includes(token));
    assert.ok(!result.body.includes(process.env.UPSTASH_REDIS_REST_URL));
  }
  failure = '';
  assert.equal(data.has(key('requests')), false);
});

test('admin requires configured password, login and a CSRF token', async () => {
  const cookies = jar();
  data.set(key('requests'), { value: [JSON.stringify({ date: '2026-11-15T00:00:00Z', ...valid })] });
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await call('/admin.php', undefined, cookies)).status, 503);
  process.env.ADMIN_PASSWORD = password;
  const initial = await call('/admin.php', undefined, cookies);
  assert.equal(initial.status, 200);
  assert.ok(!initial.body.includes(valid.phone));
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initial.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await call('/admin.php', { action: 'login', password }, cookies)).status, 403);
  assert.equal((await call('/admin.php', { action: 'login', token: csrf(initial.body), password: 'incorrect' }, cookies)).status, 401);
  assert.equal((await call('/admin.php', { action: 'login', token: csrf(initial.body), password }, cookies, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/admin.php', { action: 'login', token: csrf(initial.body), password }, cookies, { Origin: base })).status, 303);
  const page = await call('/admin.php', undefined, cookies);
  assert.ok(page.body.includes(valid.name));
  assert.ok(!page.body.includes(password));
  const guest = await call('/admin.php');
  assert.ok(!guest.body.includes(valid.phone));
});

test('logout revokes the server session and password changes invalidate old sessions', async () => {
  const cookies = await login();
  const oldCookie = new Map(cookies);
  const page = await call('/admin.php', undefined, cookies);
  assert.equal((await call('/admin.php', { action: 'logout', token: 'bad' }, cookies)).status, 403);
  assert.ok((await call('/admin.php', undefined, cookies)).body.includes('Заявки с сайта'));
  assert.equal((await call('/admin.php', { action: 'logout', token: csrf(page.body) }, cookies)).status, 303);
  assert.ok((await call('/admin.php', undefined, oldCookie)).body.includes('Вход в админку'));
  const fresh = await login();
  process.env.ADMIN_PASSWORD = 'changed-admin-password-2026';
  assert.ok((await call('/admin.php', undefined, fresh)).body.includes('Вход в админку'));
  for (const entry of data.values()) assert.notEqual(entry.value, password);
});

test('session expiry, HTTPS cookie flags and environment separation work', async () => {
  const cookies = await login();
  const sessionKey = [...data.keys()].find(name => name.includes(':session:'));
  assert.ok(data.get(sessionKey).expires > Date.now());
  process.env.VERCEL_ENV = 'preview';
  assert.ok((await call('/admin.php', undefined, cookies)).body.includes('Вход в админку'));
  process.env.VERCEL_ENV = 'production';
  assert.ok((await call('/admin.php', undefined, cookies)).body.includes('Заявки с сайта'));
  data.get(sessionKey).expires = Date.now() - 1;
  assert.ok((await call('/admin.php', undefined, cookies)).body.includes('Вход в админку'));
  const securePage = await call('/admin.php', undefined, jar(), { 'X-Forwarded-Proto': 'https' });
  assert.match(securePage.headers.get('set-cookie'), /__Host-granfort-csrf=/);
  assert.match(securePage.headers.get('set-cookie'), /; Secure/);
});

test('UTF-8 JSON split across network chunks is stored without corruption', async () => {
  const bytes = Buffer.from(JSON.stringify(valid));
  const status = await new Promise((resolve, reject) => {
    const req = http.request(base + '/request.php', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    for (const byte of bytes) req.write(Buffer.from([byte]));
    req.end();
  });
  assert.equal(status, 201);
  assert.equal(JSON.parse(list(key('requests'))[0]).name, valid.name);
});

test('admin output escapes saved fields and paginates from newest to oldest', async () => {
  const values = Array.from({ length: 73 }, (_, i) => JSON.stringify({ date: '2026-11-15T00:00:00Z', name: `Заявка ${i}`, phone: '+70000000000', service: 'Консультация' }));
  values.push(JSON.stringify({ date: '<b>date</b>', name: '<script>alert(1)</script>', phone: '+70000000000', service: '<img src=x onerror=alert(1)>' }), 'broken');
  data.set(key('requests'), { value: values });
  const cookies = await login();
  const first = await call('/admin.php', undefined, cookies);
  assert.ok(first.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(first.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!first.body.includes('<script>alert(1)</script>'));
  assert.ok(first.body.includes('Не удалось прочитать записей: 1'));
  assert.ok(first.body.includes('Страница 1 из 2'));
  assert.ok(!first.body.includes('<td>Заявка 0</td>'));
  const second = await call('/admin.php?page=2', undefined, cookies);
  assert.ok(second.body.includes('<td>Заявка 0</td>'));
  assert.ok(!second.body.includes('<td>Заявка 72</td>'));
  const invalid = await call('/admin.php?page=NaN', undefined, cookies);
  assert.ok(invalid.body.includes('Страница 1 из 2'));
  assert.deepEqual(list(key('requests')), values);
});

test('rate limits expire and provider outages hide protected data', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await call('/request.php', valid)).status, 201);
  const result = await call('/request.php', valid);
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '60');
  const counterKey = [...data.keys()].find(name => name.includes(':rate:requests:'));
  data.get(counterKey).expires = Date.now() - 1;
  assert.equal((await call('/request.php', valid)).status, 201);
  const cookies = await login();
  failure = 'http';
  const page = await call('/admin.php', undefined, cookies);
  assert.equal(page.status, 503);
  assert.ok(!page.body.includes(valid.phone));
});

test('legacy JSONL import is repeatable, skips bad lines and preserves its source file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'granfort-import-'));
  const file = path.join(directory, 'requests.jsonl');
  const content = [JSON.stringify({ date: '2026-11-15T00:00:00Z', ...valid }), 'broken', JSON.stringify({ date: '2026-11-15T01:00:00Z', ...valid, name: 'Импорт' })].join('\n');
  await fs.writeFile(file, content);
  try {
    const execute = () => promisify(execFile)(process.execPath, [path.join(__dirname, '../scripts/import-requests.cjs'), file, '--production'], { env: process.env });
    const first = await execute();
    assert.match(first.stdout, /Добавлено: 2/);
    assert.ok(!first.stdout.includes(valid.phone));
    const second = await execute();
    assert.match(second.stdout, /Добавлено: 0/);
    assert.match(second.stdout, /Уже импортированы: 2/);
    assert.equal(list(key('requests')).length, 2);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
