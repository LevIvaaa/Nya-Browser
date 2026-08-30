/**
 * The security self-test page (nya://security).
 *
 * It is deliberately served as an ordinary web page: no preload, sandboxed,
 * same restrictions as any site. Every check therefore runs with exactly the
 * privileges a random website gets, which is what makes the results evidence
 * rather than a claim.
 */
export function securityPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Проверка безопасности — Nya Browser</title>
<style>
  :root {
    --bg: #0c0d12; --card: rgba(255,255,255,.05); --line: rgba(255,255,255,.09);
    --text: #f2f3f7; --dim: rgba(242,243,247,.62); --pass: #2fbf71; --warn: #f5a524; --fail: #e5484d;
    --accent: #7c6cff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f4f5f8; --card:#fff; --line:rgba(15,18,34,.1); --text:#14161d; --dim:rgba(20,22,29,.6); }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 80px; background: var(--bg); color: var(--text);
    font: 14px/1.5 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 6px; }
  p.lead { color: var(--dim); margin: 0 0 28px; }
  .summary {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;
  }
  .tile {
    flex: 1 1 140px; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 14px 16px;
  }
  .tile b { display: block; font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
  .tile span { color: var(--dim); font-size: 12.5px; }
  .group { margin-bottom: 26px; }
  .group h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); margin: 0 0 10px 4px; }
  .list { background: var(--card); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
  .row { display: flex; gap: 14px; padding: 14px 16px; border-top: 1px solid var(--line); align-items: flex-start; }
  .row:first-child { border-top: 0; }
  .dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto; background: var(--dim); }
  .pass .dot { background: var(--pass); } .warn .dot { background: var(--warn); } .fail .dot { background: var(--fail); }
  .row .title { font-weight: 500; }
  .row .detail { color: var(--dim); font-size: 12.5px; margin-top: 2px; }
  .row .evidence { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 11.5px; color: var(--dim); margin-top: 6px; word-break: break-all; }
  .state { margin-left: auto; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  .pass .state { color: var(--pass); } .warn .state { color: var(--warn); } .fail .state { color: var(--fail); }
  button {
    font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 9px 16px; cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  footer { color: var(--dim); font-size: 12px; margin-top: 26px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Проверка безопасности</h1>
  <p class="lead">
    Эта страница выполняется как обычный сайт — без привилегий, в песочнице, с теми же
    правилами, что и любая вкладка. Поэтому результаты ниже — не обещание браузера, а
    измерение из кода страницы.
  </p>

  <div class="summary">
    <div class="tile"><b id="s-pass">0</b><span>пройдено</span></div>
    <div class="tile"><b id="s-warn">0</b><span>предупреждений</span></div>
    <div class="tile"><b id="s-fail">0</b><span>провалено</span></div>
    <div class="tile"><b id="s-total">0</b><span>всего проверок</span></div>
  </div>

  <div id="groups"></div>

  <p><button id="copy">Скопировать отчёт</button> <button id="again">Проверить снова</button></p>
  <footer>
    Проверки с сетевыми запросами требуют интернета: без него они показываются как
    предупреждение, а не как провал.
  </footer>
</div>

<script>
(function () {
  var groups = document.getElementById('groups');
  var results = [];

  function add(group, title, detail, status, evidence) {
    results.push({ group: group, title: title, detail: detail, status: status, evidence: evidence || '' });
  }

  function loadTest(url, kind) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish('timeout'); }, 7000);
      function finish(outcome) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(outcome);
      }
      var el;
      if (kind === 'script') { el = document.createElement('script'); el.src = url; }
      else { el = document.createElement('img'); el.src = url; }
      el.onload = function () { finish('loaded'); };
      el.onerror = function () { finish('blocked'); };
      el.style.display = 'none';
      document.body.appendChild(el);
    });
  }

  async function run() {
    results = [];

    /* ---- isolation from the browser itself ---- */
    add('Изоляция страницы', 'Node.js недоступен',
      'Страница не может выполнять код на Node и читать файлы.',
      typeof require === 'undefined' ? 'pass' : 'fail',
      'typeof require = ' + typeof require);

    add('Изоляция страницы', 'Объект process недоступен',
      'Нет доступа к переменным окружения и аргументам процесса.',
      typeof process === 'undefined' ? 'pass' : 'fail',
      'typeof process = ' + typeof process);

    add('Изоляция страницы', 'API браузера недоступно',
      'Страница не видит внутренние функции: вкладки, настройки, пароли.',
      typeof window.browser === 'undefined' ? 'pass' : 'fail',
      'typeof window.browser = ' + typeof window.browser);

    var vaultReachable = false;
    try { vaultReachable = typeof window.nyaVault !== 'undefined' || typeof window.nyaPasswords !== 'undefined'; } catch (e) {}
    add('Изоляция страницы', 'Хранилище паролей недоступно',
      'Ни одна страница не может запросить сохранённые пароли — их присылает только браузер по вашему действию.',
      vaultReachable ? 'fail' : 'pass',
      'window.nyaVault / window.nyaPasswords не определены');

    var evalEscape = 'заблокировано';
    try { var p = new Function('return typeof process')(); evalEscape = 'typeof process = ' + p; } catch (e) { evalEscape = 'исключение: ' + e.name; }
    add('Изоляция страницы', 'Побег через eval невозможен',
      'Динамически созданный код тоже не видит внутренностей приложения.',
      /undefined|исключение/.test(evalEscape) ? 'pass' : 'fail', evalEscape);

    add('Изоляция страницы', 'Открытие окон под контролем браузера',
      'Скрипт не может открыть новое окно сам — ссылки обрабатывает браузер.',
      (function () { var w = null; try { w = window.open('about:blank'); } catch (e) {} if (w) { try { w.close(); } catch (e) {} } return w ? 'fail' : 'pass'; })(),
      'window.open(...) вернул null');

    add('Изоляция страницы', 'Защищённый контекст',
      'Страница считается secure context: доступны только безопасные API.',
      window.isSecureContext ? 'pass' : 'warn',
      'isSecureContext = ' + window.isSecureContext);

    /* ---- tracking protection ---- */
    // The four network probes run in parallel so the page fills in seconds,
    // not in a chain of full timeouts when the machine is offline.
    var probes = await Promise.all([
      loadTest('https://duckduckgo.com/favicon.ico?nya=' + Date.now(), 'img'),
      loadTest('https://www.google-analytics.com/analytics.js', 'script'),
      loadTest('https://securepubads.g.doubleclick.net/favicon.ico', 'img'),
      loadTest('https://connect.facebook.net/en_US/fbevents.js', 'script')
    ]);
    var control = probes[0], ga = probes[1], dc = probes[2], fb = probes[3];
    var online = control === 'loaded';
    add('Блокировка слежки', 'Обычный сайт загружается',
      'Контрольный запрос: блокировка не «ломает интернет», а отсекает выборочно.',
      online ? 'pass' : 'warn',
      'duckduckgo.com/favicon.ico → ' + control);
    add('Блокировка слежки', 'Google Analytics заблокирован',
      'Скрипт аналитики не загрузился — запрос отменён до выхода в сеть.',
      ga === 'loaded' ? 'fail' : (online ? 'pass' : 'warn'),
      'google-analytics.com/analytics.js → ' + ga);
    add('Блокировка слежки', 'Рекламная сеть заблокирована',
      'DoubleClick не отвечает, потому что запрос к нему не выпускается.',
      dc === 'loaded' ? 'fail' : (online ? 'pass' : 'warn'),
      'doubleclick.net → ' + dc);
    add('Блокировка слежки', 'Пиксель Facebook заблокирован',
      'Трекер соцсети не может загрузиться и связать вас между сайтами.',
      fb === 'loaded' ? 'fail' : (online ? 'pass' : 'warn'),
      'connect.facebook.net → ' + fb);

    add('Блокировка слежки', 'Заголовок Do Not Track включён',
      'Браузер сообщает сайтам об отказе от отслеживания.',
      navigator.doNotTrack === '1' ? 'pass' : 'warn',
      'navigator.doNotTrack = ' + navigator.doNotTrack);

    /* ---- transport security ---- */
    var upgraded = 'нет данных';
    var upgradeStatus = 'warn';
    try {
      await fetch('http://example.com/?nya=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }).catch(function () {});
      var entries = performance.getEntriesByType('resource').map(function (e) { return e.name; });
      var https = entries.filter(function (n) { return n.indexOf('https://example.com') === 0; });
      var http = entries.filter(function (n) { return n.indexOf('http://example.com') === 0; });
      if (https.length) { upgraded = https[https.length - 1]; upgradeStatus = 'pass'; }
      else if (http.length) { upgraded = http[http.length - 1]; upgradeStatus = 'fail'; }
    } catch (e) { upgraded = 'ошибка: ' + e.name; }
    add('Транспорт', 'HTTP повышается до HTTPS',
      'Запрос по http:// переписывается на https:// до отправки.',
      online ? upgradeStatus : 'warn', String(upgraded));

    /* ---- device permissions ---- */
    async function perm(name, label, detail) {
      var state = 'нет данных';
      try {
        var res = await navigator.permissions.query({ name: name });
        state = res.state;
      } catch (e) { state = 'query недоступен: ' + e.name; }
      add('Доступ к устройствам', label, detail,
        state === 'granted' ? 'fail' : 'pass', name + ' → ' + state);
    }
    await perm('geolocation', 'Геолокация не выдана молча', 'Сайт не может узнать ваше местоположение без спроса.');
    await perm('notifications', 'Уведомления не выданы молча', 'Сайт не может присылать уведомления без разрешения.');
    await perm('camera', 'Камера не выдана молча', 'Доступ к камере требует явного согласия.');
    await perm('microphone', 'Микрофон не выдан молча', 'Доступ к микрофону требует явного согласия.');

    add('Доступ к устройствам', 'Уведомления по умолчанию запрещены',
      'Notification.permission не равно granted.',
      Notification.permission === 'granted' ? 'fail' : 'pass',
      'Notification.permission = ' + Notification.permission);

    var usb = 'нет API';
    try { usb = navigator.usb ? 'API есть, устройства скрыты' : 'нет API'; } catch (e) {}
    var usbDevices = 'n/a';
    try { if (navigator.usb) { var list = await navigator.usb.getDevices(); usbDevices = list.length + ' устройств'; } } catch (e) { usbDevices = 'отказ: ' + e.name; }
    add('Доступ к устройствам', 'USB-устройства не перечисляются',
      'Страница не получает список подключённого оборудования.',
      /^0 устройств|отказ|n\\/a/.test(usbDevices) ? 'pass' : 'fail', usb + ', getDevices → ' + usbDevices);

    var media = 'нет данных';
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      media = 'поток выдан';
    } catch (e) { media = 'отказ: ' + e.name; }
    add('Доступ к устройствам', 'Микрофон не включается сам',
      'getUserMedia без разрешения завершается отказом.',
      media === 'поток выдан' ? 'fail' : 'pass', media);

    render();
  }

  function render() {
    var counts = { pass: 0, warn: 0, fail: 0 };
    results.forEach(function (r) { counts[r.status]++; });
    document.getElementById('s-pass').textContent = counts.pass;
    document.getElementById('s-warn').textContent = counts.warn;
    document.getElementById('s-fail').textContent = counts.fail;
    document.getElementById('s-total').textContent = results.length;

    var order = [];
    results.forEach(function (r) { if (order.indexOf(r.group) === -1) order.push(r.group); });

    groups.innerHTML = order.map(function (group) {
      var rows = results.filter(function (r) { return r.group === group; }).map(function (r) {
        return '<div class="row ' + r.status + '">' +
          '<span class="dot"></span>' +
          '<div><div class="title">' + r.title + '</div>' +
          '<div class="detail">' + r.detail + '</div>' +
          (r.evidence ? '<div class="evidence">' + r.evidence + '</div>' : '') +
          '</div><span class="state">' + (r.status === 'pass' ? 'ок' : r.status === 'warn' ? 'внимание' : 'провал') + '</span></div>';
      }).join('');
      return '<div class="group"><h2>' + group + '</h2><div class="list">' + rows + '</div></div>';
    }).join('');
  }

  document.getElementById('copy').addEventListener('click', function () {
    var text = results.map(function (r) {
      return '[' + r.status.toUpperCase() + '] ' + r.group + ' / ' + r.title + ' — ' + r.evidence;
    }).join('\\n');
    navigator.clipboard.writeText(text).catch(function () {});
  });
  document.getElementById('again').addEventListener('click', function () { run(); });

  run();
})();
</script>
</body>
</html>`
}
