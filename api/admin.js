const { randomBytes, createHmac } = require('node:crypto');
const { redis, key, hash, rateAllowed, storageConfig } = require('../server/storage.cjs');
const { equal, cookieName, readCookie, setCookie, sameOrigin, readBody, html, redirect } = require('../server/http.cjs');
const views = require('../server/views.cjs');

const sessionTime = 8 * 60 * 60;
const validToken = token => /^[a-f0-9]{64}$/.test(token);

function sessionValue(token, password) {
  return createHmac('sha256', password).update(token).digest('hex');
}

async function authenticated(token, password) {
  if (!validToken(token)) return false;
  const saved = await redis(['GET', key(`session:${hash(token)}`)]);
  return equal(saved, sessionValue(token, password));
}

module.exports = async function admin(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return html(res, 405, views.unavailable('Используйте страницу входа в админку.'));
  }

  const password = process.env.ADMIN_PASSWORD;
  if (typeof password !== 'string' || Array.from(password).length < 12) {
    return html(res, 503, views.unavailable('В настройках Vercel задайте ADMIN_PASSWORD длиной от 12 символов и выполните Redeploy.'));
  }
  try {
    storageConfig();
  } catch {
    return html(res, 503, views.unavailable('Подключите Upstash Redis к проекту Vercel и выполните Redeploy. Инструкция есть в README проекта.'));
  }

  const session = readCookie(req, cookieName(req, 'admin'));
  let csrf = readCookie(req, cookieName(req, 'csrf'));
  if (!validToken(csrf)) {
    csrf = randomBytes(32).toString('hex');
    setCookie(req, res, 'csrf', csrf, sessionTime);
  }

  try {
    if (req.method === 'POST') {
      let fields;
      try {
        fields = await readBody(req);
      } catch {
        return html(res, 400, views.login(csrf, 'Не удалось прочитать форму.'));
      }
      if (!sameOrigin(req) || !equal(fields.token, csrf)) {
        return html(res, 403, views.login(csrf, 'Обновите страницу и попробуйте ещё раз.'));
      }

      if (fields.action === 'logout') {
        if (validToken(session)) await redis(['DEL', key(`session:${hash(session)}`)]);
        setCookie(req, res, 'admin', '', 0);
        setCookie(req, res, 'csrf', '', 0);
        return redirect(res);
      }
      if (fields.action !== 'login' || typeof fields.password !== 'string') {
        return html(res, 422, views.login(csrf, 'Введите пароль.'));
      }
      if (!await rateAllowed(req, 'login', 10, 15 * 60)) {
        res.setHeader('Retry-After', '900');
        return html(res, 429, views.login(csrf, 'Слишком много попыток входа. Попробуйте через 15 минут.'));
      }
      if (!equal(fields.password, password)) return html(res, 401, views.login(csrf, 'Неверный пароль.'));

      if (validToken(session)) await redis(['DEL', key(`session:${hash(session)}`)]);
      const token = randomBytes(32).toString('hex');
      const saved = await redis(['SET', key(`session:${hash(token)}`), sessionValue(token, password), 'EX', sessionTime]);
      if (saved !== 'OK') throw new Error('STORAGE_UNAVAILABLE');
      setCookie(req, res, 'admin', token, sessionTime);
      setCookie(req, res, 'csrf', randomBytes(32).toString('hex'), sessionTime);
      return redirect(res);
    }

    if (!await authenticated(session, password)) return html(res, 200, views.login(csrf));

    const total = await redis(['LLEN', key('requests')]);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('STORAGE_UNAVAILABLE');
    const params = new URL(req.url, 'http://localhost').searchParams;
    const pageNumber = Number(params.get('page'));
    const pages = Math.max(1, Math.ceil(total / 50));
    const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, pages) : 1;
    const records = total ? await redis(['LRANGE', key('requests'), -page * 50, -(page - 1) * 50 - 1]) : [];
    if (!Array.isArray(records)) throw new Error('STORAGE_UNAVAILABLE');
    const rows = [];
    let skipped = 0;
    for (const record of [...records].reverse()) {
      try {
        const row = JSON.parse(record);
        if (!row || !['date', 'name', 'phone', 'service'].every(field => typeof row[field] === 'string')) throw new Error();
        rows.push(row);
      } catch {
        skipped++;
      }
    }
    return html(res, 200, views.dashboard(csrf, rows, total, page, pages, skipped));
  } catch {
    return html(res, 503, views.unavailable('Не удалось подключиться к хранилищу. Попробуйте обновить страницу позже.'));
  }
};
