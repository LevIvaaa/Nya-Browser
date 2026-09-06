#!/bin/bash
# Runs after `dpkg -i`. Two jobs, both about the desktop knowing we exist.
set -e

# The sandbox helper has to be setuid root, and dpkg cannot be told to do that
# for a file electron-builder generates. Without it Chromium refuses to start
# unless it is told to run with no sandbox at all, which is not a trade worth
# making in a browser.
CHROME_SANDBOX="/opt/Nya Browser/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
  chown root:root "$CHROME_SANDBOX" || true
  chmod 4755 "$CHROME_SANDBOX" || true
fi

# So the launcher appears without logging out, and so the MimeType lines in our
# .desktop entry are indexed and the browser can be picked for a PDF or a link.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi
