const { redis, key, rateAllowed } = require('../server/storage.cjs');
const { readBody, sameOrigin, html } = require('../server/http.cjs');
const { result } = require('../server/views.cjs');

const services = ['Консультация', 'Индивидуальная разработка', 'Комплект защиты для JAC T9', 'Комплект защиты для Haval H3'];

module.exports = async function request(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return html(res, 405, result(false, ['Отправьте заявку через форму на сайте.']));
  }
  if (!sameOrigin(req)) return html(res, 403, result(false, ['Отправьте заявку с нашего сайта.']));

  let fields;
  try {
    fields = await readBody(req);
  } catch {
    return html(res, 400, result(false, ['Не удалось прочитать форму. Проверьте заполненные поля.']));
  }

  const errors = [];
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const phone = typeof fields.phone === 'string' ? fields.phone.trim() : '';
  const service = typeof fields.service === 'string' ? fields.service.trim() : '';
  if (Array.from(name).length < 2 || Array.from(name).length > 80 || /[\r\n]/.test(name)) errors.push('Укажите имя от 2 до 80 символов.');
  const digits = phone.replace(/[^0-9]/g, '');
  if (!/^[+0-9 ().-]{10,30}$/.test(phone) || digits.length < 10 || digits.length > 15) errors.push('Укажите телефон: от 10 до 15 цифр.');
  if (!services.includes(service)) errors.push('Выберите услугу из списка.');
  if (errors.length) return html(res, 422, result(false, errors));

  try {
    if (!await rateAllowed(req, 'requests', 20, 60)) {
      res.setHeader('Retry-After', '60');
      return html(res, 429, result(false, ['Слишком много заявок. Подождите минуту и попробуйте снова.']));
    }
    const row = { date: new Date().toISOString(), name, phone, service };
    const saved = await redis(['RPUSH', key('requests'), JSON.stringify(row)]);
    if (!Number.isSafeInteger(saved) || saved < 1) throw new Error('STORAGE_UNAVAILABLE');
    return html(res, 201, result(true, []));
  } catch {
    return html(res, 503, result(false, ['Не удалось сохранить заявку. Попробуйте позже или напишите нам по электронной почте.']));
  }
};
