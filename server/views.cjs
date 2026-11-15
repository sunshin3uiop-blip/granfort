const { escape } = require('./http.cjs');

function document(title, content, style = 'admin.css') {
  return `<!doctype html><html lang="ru"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow"><title>${escape(title)} — GRANFORT</title>
    <link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/${style}">
    </head><body>${content}</body></html>`;
}

function result(success, messages) {
  return document('Заявка', `<main class="request-result">
    <h1>${success ? 'Заявка сохранена' : 'Не удалось отправить заявку'}</h1>
    ${success ? '<p>Спасибо за обращение!</p>' : `<ul>${messages.map(text => `<li>${escape(text)}</li>`).join('')}</ul>`}
    <a class="button" href="/index.html#services">Вернуться на сайт</a></main>`, 'style.css');
}

function login(token, error = '') {
  return document('Вход в админку', `<main class="login-card">
    <a class="brand" href="/index.html">GRANFORT.</a><h1>Вход в админку</h1>
    <p>Введите пароль, чтобы посмотреть заявки.</p>
    ${error ? `<p class="notice error" role="alert">${escape(error)}</p>` : ''}
    <form method="post" action="/admin.php">
      <input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="login">
      <label for="password">Пароль</label><input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
      <button type="submit">Войти</button>
    </form><a class="back-link" href="/index.html">Вернуться на сайт</a></main>`);
}

function unavailable(message) {
  return document('Настройка админки', `<main class="login-card"><a class="brand" href="/index.html">GRANFORT.</a>
    <h1>Админка временно недоступна</h1><p>${escape(message)}</p>
    <a class="button" href="/index.html">На сайт</a></main>`);
}

function dashboard(token, rows, total, page, pages, skipped) {
  const table = rows.length ? `<div class="table-wrap" role="region" aria-label="Список заявок" tabindex="0">
    <table><thead><tr><th scope="col">Дата</th><th scope="col">Имя</th><th scope="col">Телефон</th><th scope="col">Услуга</th></tr></thead>
    <tbody>${rows.map(row => `<tr>${['date', 'name', 'phone', 'service'].map(field => `<td>${escape(row[field])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : (total ? '<div class="empty"><h2>Нет записей для отображения</h2><p>Проверьте сообщение о прочитанных записях или перейдите на другую страницу.</p></div>' : '<div class="empty"><h2>Пока нет заявок</h2><p>После отправки формы на сайте нажмите «Обновить».</p></div>');
  return document('Админка', `<main class="admin-page"><header>
    <div><a class="brand" href="/index.html">GRANFORT.</a><h1>Заявки с сайта</h1></div>
    <nav aria-label="Действия администратора"><a class="button" href="/admin.php">Обновить</a>
      <a class="button secondary" href="/index.html">На сайт</a>
      <form method="post" action="/admin.php"><input type="hidden" name="token" value="${escape(token)}">
        <input type="hidden" name="action" value="logout"><button class="secondary" type="submit">Выйти</button></form>
    </nav></header><p class="count">Всего заявок: <strong>${total}</strong>. Новые показываются первыми.</p>
    ${skipped ? `<p class="notice">Не удалось прочитать записей: ${skipped}.</p>` : ''}${table}
    ${pages > 1 ? `<nav class="pagination" aria-label="Страницы заявок">
      ${page > 1 ? `<a class="button secondary" href="/admin.php?page=${page - 1}">Назад</a>` : ''}
      <span>Страница ${page} из ${pages}</span>
      ${page < pages ? `<a class="button secondary" href="/admin.php?page=${page + 1}">Далее</a>` : ''}</nav>` : ''}</main>`);
}

module.exports = { result, login, unavailable, dashboard };
