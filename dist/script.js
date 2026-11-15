const dialog = document.querySelector('#info-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogCopy = document.querySelector('#dialog-copy');
const dialogContact = document.querySelector('#dialog-contact');
const requestForm = document.querySelector('#request-form');

const info = {
  'О компании': 'Мы — команда мастеров. Наша специализация — комплексный тюнинг интерьера: перетяжка кожей и алькантарой, шумоизоляция, установка мультимедиа и света.',
  'Связаться с нами': 'Оставьте имя и телефон, чтобы обсудить ваш автомобиль и пожелания.',
  'Акции': 'Информация об актуальных акциях пока не добавлена. Уточнить предложения можно по электронной почте.',
  'Доставка': 'Чтобы уточнить возможность, сроки и стоимость доставки, напишите нам и укажите свой город.',
  'Возврат': 'Для обсуждения возврата напишите нам, укажите товар и дату покупки.',
  'Бонусная программа': 'Условия бонусной программы пока не опубликованы. Подробности можно уточнить у нашей команды.',
  'Privacy Policy': 'Форма заявки сохраняет имя, телефон и выбранную услугу для обратной связи. Полный текст политики конфиденциальности для демонстрационной страницы пока не добавлен.',
  'Terms of Service': 'Это демонстрационная вёрстка. Публичные условия покупки и оказания услуг пока не добавлены.',
  'Социальные сети': 'Ссылки на официальные страницы пока не добавлены. Связаться с нами можно по электронной почте.'
};

function showInfo(title, copy, service = null) {
  dialogTitle.textContent = title;
  dialogCopy.textContent = copy;
  dialogContact.href = 'mailto:test@Grandfort.ru?subject=' + encodeURIComponent(title);
  requestForm.hidden = service === null;
  dialogContact.hidden = service !== null;
  if (service !== null) {
    requestForm.reset();
    document.querySelector('#request-service').value = service;
  }
  dialog.showModal();
}

document.querySelectorAll('[data-info]').forEach(button => {
  button.addEventListener('click', () => {
    const title = button.dataset.info;
    const service = title === 'Связаться с нами' ? 'Консультация' : null;
    showInfo(title, info[title], service);
  });
});
document.querySelectorAll('[data-service]').forEach(button => {
  button.addEventListener('click', () => showInfo(button.dataset.service, 'Оставьте имя и телефон, чтобы обсудить комплектацию, стоимость и сроки.', button.dataset.service));
});
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
nav.querySelectorAll('a,button').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}));

const searchInput = document.querySelector('.search input');
const searchStatus = document.querySelector('.search-status');
const cards = [...document.querySelectorAll('.service-card')];
function filterServices() {
  const query = searchInput.value.trim().toLowerCase();
  let count = 0;
  cards.forEach(card => {
    const match = (card.dataset.search + ' ' + card.dataset.service).toLowerCase().includes(query);
    card.hidden = !match;
    if (match) count++;
  });
  searchStatus.hidden = !query;
  searchStatus.textContent = count ? 'Найдено услуг: ' + count : 'Ничего не найдено. Попробуйте «Haval», «JAC» или «индивидуально».';
}
document.querySelector('.search').addEventListener('submit', event => {
  event.preventDefault();
  filterServices();
  document.querySelector('#services').scrollIntoView();
});
searchInput.addEventListener('input', filterServices);

const people = [
  { name: 'Ольга Антонова', role: 'Автотюнер', photo: 'assets/olga.png' },
  { name: 'Дарья Плотникова', role: 'Автомеханик', photo: 'assets/daria.png' },
  { name: 'Алина Боброва', role: 'Автомеханик', photo: 'assets/alina.png' },
  { name: 'Михаил Московский', role: 'Автотюнер', photo: 'assets/mikhail.png' }
];
const teamMedia = window.matchMedia('(max-width: 700px)');
let currentPerson = teamMedia.matches ? 2 : 0;
function selectPerson(index) {
  currentPerson = (index + people.length) % people.length;
  const mobile = teamMedia.matches;
  const person = people[currentPerson];
  document.querySelector('#featured-photo').src = person.photo;
  document.querySelector('#featured-photo').alt = person.name + ', ' + person.role.toLowerCase();
  document.querySelector('#featured-name').textContent = person.name;
  document.querySelector('#featured-role').textContent = person.role;
  document.querySelector('#mobile-person-name').textContent = person.name;
  document.querySelector('#mobile-person-role').textContent = person.role.toLowerCase();
  document.querySelectorAll('.person').forEach((button, position) => {
    const portraitIndex = mobile ? (currentPerson + position - 1 + people.length) % people.length : position + 1;
    const portrait = people[portraitIndex];
    button.dataset.person = String(portraitIndex);
    button.querySelector('img').src = portrait.photo;
    button.querySelector('img').alt = portrait.name;
    button.setAttribute('aria-label', portrait.name + ', ' + portrait.role.toLowerCase());
    const selected = Number(button.dataset.person) === currentPerson;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
document.querySelectorAll('.person').forEach(button => button.addEventListener('click', () => selectPerson(Number(button.dataset.person))));
document.querySelector('.team-prev').addEventListener('click', () => selectPerson(currentPerson - 1));
document.querySelector('.team-next').addEventListener('click', () => selectPerson(currentPerson + 1));
teamMedia.addEventListener('change', () => selectPerson(currentPerson));
selectPerson(currentPerson);

document.querySelectorAll('.faq details').forEach(item => item.addEventListener('toggle', () => {
  if (item.open) document.querySelectorAll('.faq details').forEach(other => { if (other !== item) other.open = false; });
}));
