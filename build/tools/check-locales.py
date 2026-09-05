# -*- coding: utf-8 -*-
"""Checks locale files against en.json: same key set, same {placeholders}.
Usage: python check_locale.py [code ...]  (no args = all)"""
import json, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOCALES = os.path.join(ROOT, 'src', 'shared', 'locales')
ref = json.load(io.open(os.path.join(LOCALES, 'en.json'), encoding='utf-8'))
ref_keys = set(ref)
ph = lambda s: sorted(re.findall(r'\{\w+\}', s))

on_disk = sorted(f[:-5] for f in os.listdir(LOCALES) if f.endswith('.json'))
codes = sys.argv[1:] or on_disk

# The picker's list is the contract: Russian is the source language and needs
# no file, every other language it offers must have one, and a file nobody
# offers is dead weight.
ts = io.open(os.path.join(ROOT, 'src', 'shared', 'i18n.ts'), encoding='utf-8').read()
offered = [c for c in re.findall(r"\{ code: '([\w-]+)', name:", ts) if c != 'ru']
orphan = sorted(set(on_disk) - set(offered))
absent = [c for c in offered if c not in set(on_disk)]
if orphan or absent:
    print('locales do not match LANGUAGES: %d offered without a file, %d files nobody offers'
          % (len(absent), len(orphan)))
    for c in absent:
        print('  no dictionary: ' + c)
    for c in orphan:
        print('  not offered:   ' + c)
    sys.exit(1)
bad = 0
for code in codes:
    path = os.path.join(LOCALES, code + '.json')
    if not os.path.exists(path):
        print(f'{code}: MISSING FILE'); bad += 1; continue
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        print(f'{code}: BROKEN JSON: {e}'); bad += 1; continue
    missing = ref_keys - set(data)
    extra = set(data) - ref_keys
    phbad = [k for k in ref_keys & set(data) if ph(k) != ph(data[k])]
    empty = [k for k in data if not str(data[k]).strip()]
    if missing or extra or phbad or empty:
        bad += 1
        print(f'{code}: {len(missing)} missing, {len(extra)} extra, {len(phbad)} placeholder mismatch, {len(empty)} empty')
        for k in list(missing)[:5]: print(f'  missing: {k!r}')
        for k in list(extra)[:5]: print(f'  extra:   {k!r}')
        for k in phbad[:5]: print(f'  ph:      {k!r} -> {data[k]!r}')
    else:
        print(f'{code}: OK ({len(data)} keys)')
sys.exit(1 if bad else 0)
