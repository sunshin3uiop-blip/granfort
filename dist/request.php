<?php
// Получаем данные из формы и сохраняем заявку в файл.
$errors = [];
$saved = false;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    $errors[] = 'Отправьте заявку через форму на сайте.';
} else {
    $name = $_POST['name'] ?? '';
    $phone = $_POST['phone'] ?? '';
    $service = $_POST['service'] ?? '';

    $services = [
        'Консультация',
        'Индивидуальная разработка',
        'Комплект защиты для JAC T9',
        'Комплект защиты для Haval H3'
    ];

    if (!is_string($name) || !is_string($phone) || !is_string($service)) {
        $errors[] = 'Проверьте заполненные поля формы.';
    } else {
        $name = trim($name);
        $phone = trim($phone);
        $service = trim($service);
        $digits = preg_replace('/[^0-9]/', '', $phone);

        if (!preg_match('/^.{2,80}$/u', $name)) {
            $errors[] = 'Укажите имя от 2 до 80 символов.';
        }

        if (!preg_match('/^[+0-9 ().-]{10,30}$/D', $phone) || strlen($digits) < 10 || strlen($digits) > 15) {
            $errors[] = 'Укажите телефон: от 10 до 15 цифр.';
        }

        if (!in_array($service, $services, true)) {
            $errors[] = 'Выберите услугу из списка.';
        }
    }

    if ($errors) {
        http_response_code(422);
    } else {
        // Папка находится вне dist, поэтому её нельзя открыть через сайт.
        $folder = dirname(__DIR__) . '/data';

        if (!is_dir($folder) && !@mkdir($folder, 0770, true) && !is_dir($folder)) {
            http_response_code(500);
            $errors[] = 'Не удалось сохранить заявку. Попробуйте позже.';
        } else {
            $request = [
                'date' => date(DATE_ATOM),
                'name' => $name,
                'phone' => $phone,
                'service' => $service
            ];

            // Одна строка файла — одна заявка в формате JSON.
            $line = json_encode($request, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $written = $line === false ? false : @file_put_contents(
                $folder . '/requests.jsonl',
                $line . PHP_EOL,
                FILE_APPEND | LOCK_EX
            );

            if ($written === false) {
                http_response_code(500);
                $errors[] = 'Не удалось сохранить заявку. Попробуйте позже.';
            } else {
                $saved = true;
                http_response_code(201);
            }
        }
    }
}

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Заявка — GRANFORT</title>
    <link rel="stylesheet" href="assets/fonts.css">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main class="request-result">
        <?php if ($saved): ?>
            <h1>Заявка сохранена</h1>
            <p>Спасибо за обращение!</p>
        <?php else: ?>
            <h1>Не удалось отправить заявку</h1>
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
        <a class="button" href="index.html#services">Вернуться на сайт</a>
    </main>
</body>
</html>
