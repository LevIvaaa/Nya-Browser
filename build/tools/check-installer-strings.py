# -*- coding: utf-8 -*-
"""Checks the installer's own words: one file per language the picker offers,
the same key set everywhere, the same {placeholders} as Russian, nothing blank.

The installer paints these strings over text-free artwork at run time, so a
missing key is not a compile error and not a crash — it is a blank line in a
window someone is looking at. This is where that gets caught instead.

  python check-installer-strings.py
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STRINGS = os.path.join(ROOT, 'build', 'installer-strings')
TS = os.path.join(ROOT, 'src', 'shared', 'i18n.ts')

ts = io.open(TS, encoding='utf-8').read()
offered = re.findall(r"\{ code: '([\w-]+)', name:", ts)

ref = json.load(io.open(os.path.join(STRINGS, 'ru.json'), encoding='utf-8'))
ref_keys = set(ref)
ph = lambda s: sorted(re.findall(r'\{\w+\}', s))

on_disk = sorted(f[:-5] for f in os.listdir(STRINGS) if f.endswith('.json'))
orphan = sorted(set(on_disk) - set(offered))
if orphan:
    print('installer strings nobody offers: ' + ', '.join(orphan))
    sys.exit(1)

bad = 0
for code in offered:
    path = os.path.join(STRINGS, code + '.json')
    if not os.path.exists(path):
        print(code + ': MISSING FILE')
        bad += 1
        continue
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as error:
        print(code + ': BROKEN JSON: ' + str(error))
        bad += 1
        continue
    missing = ref_keys - set(data)
    extra = set(data) - ref_keys
    phbad = [k for k in ref_keys & set(data) if ph(ref[k]) != ph(data[k])]
    empty = [k for k in data if not str(data[k]).strip()]
    if missing or extra or phbad or empty:
        bad += 1
        print('%s: %d missing, %d extra, %d placeholder mismatch, %d empty'
              % (code, len(missing), len(extra), len(phbad), len(empty)))
        for k in sorted(missing)[:5]:
            print('  missing: ' + k)
        for k in sorted(extra)[:5]:
            print('  extra:   ' + k)
        for k in phbad[:5]:
            print('  ph:      %s -> %r' % (k, data[k]))
        for k in empty[:5]:
            print('  empty:   ' + k)

if bad:
    sys.exit(1)
print('installer strings: %d languages, %d keys each' % (len(offered), len(ref_keys)))
