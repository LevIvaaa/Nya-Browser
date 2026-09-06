# Сборка под Linux

Пакет `.deb` собирается из того же дерева, что и установщик под Windows. Ничего
кроссплатформенного в самой сборке нет: пакет собирается **на Linux**, потому
что electron-builder кладёт в него линуксовый бинарник Electron и зовёт
`dpkg-deb`.

## Где собирать

Отдельная рабочая копия **внутри** файловой системы WSL, не в `/mnt/c`:

```bash
git clone https://github.com/LevIvaaa/Nya-Browser.git ~/nya-browser
```

Две причины. `node_modules` под Windows и под Linux разные — Electron и esbuild
тянут бинарники под свою платформу, и общая папка заставит их переустанавливаться
при каждом переключении. И `/mnt/c` из WSL работает в разы медленнее, чем
родная файловая система.

## Что нужно в системе

Node 20.19+ (Vite 7 старее не берёт; в Ubuntu 24.04 из коробки лежит 18),
и `fakeroot` с `dpkg-deb`, которые в Ubuntu уже есть. Остальное — `fpm`,
линуксовый Electron — electron-builder скачивает сам при первой сборке.

Node без root, распаковкой официального архива:

```bash
V=v22.20.0
curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz" | tar -xJ -C ~/.local
mv ~/.local/node-$V-linux-x64 ~/.local/node-$V
export PATH="$HOME/.local/node-$V/bin:$PATH"
```

## Сборка

```bash
npm ci
node node_modules/electron/install.js   # см. ниже
npm run check
npm run dist:deb
```

Вторая строка нужна не всегда: postinstall у пакета `electron` иногда не
отрабатывает при `npm ci`, и тогда сборка падает на `The specified electronDist
does not exist`. Запуск `install.js` руками распаковывает дистрибутив на место.
Проверить: в `node_modules/electron/dist` должно лежать около 300 МБ.

Готовый пакет — `dist/nya-browser_<версия>_amd64.deb`.

## Что делает пакет при установке

`postinst` делает две вещи. Ставит `chrome-sandbox` в setuid root — без этого
Chromium отказывается запускаться, а запускать браузер с `--no-sandbox` не тот
размен, на который стоит идти. И обновляет базы `.desktop` и иконок, чтобы
ярлык появился без перезахода в сессию, а строка `MimeType` начала действовать:
браузер можно выбрать для ссылки и для PDF.

## Чего в линуксовой сборке нет

Windows Hello — аналога нет, хранилище паролей остаётся на мастер-пароле.
Шифрование хранилища идёт через `safeStorage`, а он на Linux опирается на
libsecret: без gnome-keyring или kwallet ключ будет заметно слабее.

Автообновления тоже нет, и это осознанно: `.deb` — епархия менеджера пакетов,
и подменять файлы в `/opt` за спиной у dpkg значит рассинхронизировать систему
с тем, что в ней на самом деле стоит. Браузер проверяет GitHub и предлагает
открыть страницу загрузки.
