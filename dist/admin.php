<?php
// Простой вход по паролю. Данные храним в той же папке, что и заявки.
ini_set('session.use_strict_mode', '1');
session_name('granfort_admin');
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'
]);
session_start();
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');

$folder = dirname(__DIR__) . '/data';
$passwordFile = $folder . '/admin-password.hash';
$requestsFile = $folder . '/requests.jsonl';
$passwordHash = is_file($passwordFile) ? @file_get_contents($passwordFile) : false;
$setup = !file_exists($passwordFile);
$error = '';

if (!$setup && ($passwordHash === false || password_get_info(trim($passwordHash))['algoName'] === 'unknown')) {
    http_response_code(500);
    $error = 'Не удалось прочитать настройки входа.';
    $passwordHash = '';
}
$passwordHash = is_string($passwordHash) ? trim($passwordHash) : '';

if (!isset($_SESSION['token'])) {
    $_SESSION['token'] = bin2hex(random_bytes(32));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $error === '') {
    $token = $_POST['token'] ?? '';
    $action = $_POST['action'] ?? '';
    $password = $_POST['password'] ?? '';

    if (!is_string($token) || !hash_equals($_SESSION['token'], $token)) {
        http_response_code(403);
        $error = 'Обновите страницу и попробуйте ещё раз.';
    } elseif ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: admin.php', true, 303);
        exit;
    } elseif (!is_string($password)) {
        http_response_code(422);
        $error = 'Введите пароль.';
    } elseif ($setup && $action === 'setup') {
        $confirmation = $_POST['confirmation'] ?? '';

        if (!preg_match('/^.{8,}$/us', $password)) {
            http_response_code(422);
            $error = 'В пароле должно быть не меньше 8 символов.';
        } elseif (strlen($password) > 72) {
            http_response_code(422);
            $error = 'Пароль слишком длинный. Используйте более короткий пароль.';
        } elseif (!is_string($confirmation) || $password !== $confirmation) {
            http_response_code(422);
            $error = 'Пароли не совпадают.';
        } elseif (!is_dir($folder) && !@mkdir($folder, 0770, true) && !is_dir($folder)) {
            http_response_code(500);
            $error = 'Не удалось сохранить настройки входа.';
        } else {
            $hash = password_hash($password, PASSWORD_DEFAULT);
            // Режим x не позволяет перезаписать уже созданный пароль.
            $file = @fopen($passwordFile, 'x');

            if ($file === false) {
                http_response_code(409);
                $error = 'Не удалось создать пароль. Обновите страницу и попробуйте войти.';
            } else {
                $written = fwrite($file, $hash);
                fclose($file);

                if ($written !== strlen($hash)) {
                    @unlink($passwordFile);
                    http_response_code(500);
                    $error = 'Не удалось сохранить пароль. Попробуйте ещё раз.';
                } else {
                    session_regenerate_id(true);
                    $_SESSION['admin_hash'] = $hash;
                    $_SESSION['token'] = bin2hex(random_bytes(32));
                    header('Location: admin.php', true, 303);
                    exit;
                }
            }
        }
    } elseif (!$setup && $action === 'login' && password_verify($password, $passwordHash)) {
        session_regenerate_id(true);
        $_SESSION['admin_hash'] = $passwordHash;
        $_SESSION['token'] = bin2hex(random_bytes(32));
        header('Location: admin.php', true, 303);
        exit;
    } else {
        http_response_code(401);
        $error = 'Неверный пароль.';
    }
}

// Если пароль сбросили, старые сеансы входа больше не подходят.
$loggedIn = $passwordHash !== ''
    && isset($_SESSION['admin_hash'])
    && is_string($_SESSION['admin_hash'])
    && hash_equals($passwordHash, $_SESSION['admin_hash']);
$requests = [];
$readError = '';
$skipped = 0;

if ($loggedIn && file_exists($requestsFile)) {
    $file = @fopen($requestsFile, 'r');

    if ($file === false) {
        $readError = 'Не удалось прочитать заявки.';
    } elseif (!flock($file, LOCK_SH)) {
        $readError = 'Не удалось прочитать заявки. Попробуйте обновить страницу.';
        fclose($file);
    } else {
        while (($line = fgets($file)) !== false) {
            if (trim($line) === '') {
                continue;
            }
            $row = json_decode($line, true);

            if (!is_array($row)
                || !isset($row['date'], $row['name'], $row['phone'], $row['service'])
                || !is_string($row['date']) || !is_string($row['name'])
                || !is_string($row['phone']) || !is_string($row['service'])) {
                $skipped++;
                continue;
            }
            $requests[] = $row;
        }
        flock($file, LOCK_UN);
        fclose($file);
        $requests = array_reverse($requests);
    }
}

function escape($value) {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Админка — GRANFORT</title>
    <link rel="stylesheet" href="assets/fonts.css">
    <link rel="stylesheet" href="admin.css">
</head>
<body>
    <?php if (!$loggedIn): ?>
        <main class="login-card">
            <a class="brand" href="index.html">GRANFORT.</a>
            <h1><?= $setup ? 'Создать пароль' : 'Вход в админку' ?></h1>
            <p><?= $setup ? 'Задайте пароль для просмотра заявок. Его нужно создать только один раз.' : 'Введите пароль, чтобы посмотреть заявки.' ?></p>
            <?php if ($error !== ''): ?>
                <p class="notice error" role="alert"><?= escape($error) ?></p>
            <?php endif; ?>
            <form method="post" action="admin.php">
                <input type="hidden" name="token" value="<?= escape($_SESSION['token']) ?>">
                <input type="hidden" name="action" value="<?= $setup ? 'setup' : 'login' ?>">
                <label for="password">Пароль</label>
                <input id="password" type="password" name="password" autocomplete="<?= $setup ? 'new-password' : 'current-password' ?>" <?= $setup ? 'minlength="8" maxlength="72"' : '' ?> required autofocus>
                <?php if ($setup): ?>
                    <label for="confirmation">Повторите пароль</label>
                    <input id="confirmation" type="password" name="confirmation" minlength="8" maxlength="72" autocomplete="new-password" required>
                <?php endif; ?>
                <button type="submit"><?= $setup ? 'Создать пароль и войти' : 'Войти' ?></button>
            </form>
            <a class="back-link" href="index.html">Вернуться на сайт</a>
        </main>
    <?php else: ?>
        <main class="admin-page">
            <header>
                <div><a class="brand" href="index.html">GRANFORT.</a><h1>Заявки с сайта</h1></div>
                <nav aria-label="Действия администратора">
                    <a class="button" href="admin.php">Обновить</a>
                    <a class="button secondary" href="index.html">На сайт</a>
                    <form method="post" action="admin.php">
                        <input type="hidden" name="token" value="<?= escape($_SESSION['token']) ?>">
                        <input type="hidden" name="action" value="logout">
                        <button class="secondary" type="submit">Выйти</button>
                    </form>
                </nav>
            </header>
            <?php if ($error !== ''): ?><p class="notice error" role="alert"><?= escape($error) ?></p><?php endif; ?>
            <?php if ($readError !== ''): ?>
                <p class="notice error" role="alert"><?= escape($readError) ?></p>
            <?php else: ?>
                <p class="count">Всего заявок: <strong><?= count($requests) ?></strong>. Новые показываются первыми.</p>
                <?php if ($skipped > 0): ?><p class="notice">Не удалось прочитать записей: <?= $skipped ?>.</p><?php endif; ?>
                <?php if (!$requests): ?>
                    <div class="empty"><h2>Пока нет заявок</h2><p>После отправки формы на сайте нажмите «Обновить».</p></div>
                <?php else: ?>
                    <div class="table-wrap" role="region" aria-label="Список заявок" tabindex="0">
                        <table>
                            <thead><tr><th scope="col">Дата</th><th scope="col">Имя</th><th scope="col">Телефон</th><th scope="col">Услуга</th></tr></thead>
                            <tbody>
                                <?php foreach ($requests as $request): ?>
                                    <tr>
                                        <td><?= escape($request['date']) ?></td>
                                        <td><?= escape($request['name']) ?></td>
                                        <td><?= escape($request['phone']) ?></td>
                                        <td><?= escape($request['service']) ?></td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                <?php endif; ?>
            <?php endif; ?>
        </main>
    <?php endif; ?>
</body>
</html>
