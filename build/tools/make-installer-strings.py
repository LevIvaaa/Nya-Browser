# -*- coding: utf-8 -*-
"""Writes build/installer-strings/<code>.json from compact value lists.

The installer's own text is not part of the browser's dictionaries: the
browser reads JSON at run time, the installer reads INI files generated from
these at build time. Keeping them apart means the browser does not ship 31
strings it never shows.
"""
import io, json, os

KEYS = [
    'welcome.tagline', 'welcome.install', 'welcome.pathLabel', 'welcome.browse',
    'welcome.desktop', 'welcome.default', 'welcome.version', 'welcome.systemLang',
    'installing.title', 'installing.subtitle', 'installing.hint',
    'installed.title', 'installed.subtitle', 'installed.launch', 'installed.hint',
    'updating.title', 'updating.subtitle', 'updating.hint',
    'unconfirm.title', 'unconfirm.subtitle', 'unconfirm.remove', 'unconfirm.cancel',
    'unconfirm.wipe', 'unconfirm.version',
    'unprogress.title', 'unprogress.subtitle', 'unprogress.hint',
    'undone.title', 'undone.subtitle', 'undone.close', 'undone.hint',
]

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'installer-strings')


def write(code, values):
    if len(values) != len(KEYS):
        raise SystemExit('%s: %d values for %d keys' % (code, len(values), len(KEYS)))
    if '{v}' not in values[6] or '{v}' not in values[23]:
        raise SystemExit('%s: the version placeholder went missing' % code)
    with io.open(os.path.join(OUT, code + '.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(dict(zip(KEYS, values)), f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write('\n')


def run(table):
    for code, values in table.items():
        write(code, values)
    print(len(table), 'files written')
