# -*- coding: utf-8 -*-
"""Builds design-canvas artboards of every installer window in several languages.

The installer's windows are the artboards in design/*.dc.html with the words
lifted out into build/installer-strings. This puts the words back in — one copy
of each window per language — so the whole set can be looked at side by side
before anyone runs an installer.

    python build/tools/make-language-artboards.py <output directory>
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESIGN = os.path.join(ROOT, 'design')
STRINGS = os.path.join(ROOT, 'build', 'installer-strings')
VERSION = json.load(io.open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']

# The windows, in the order a person meets them.
PAGES = [
    ('Main', 'Welcome'),
    ('Installing', 'Installing'),
    ('Installed', 'Installed'),
    ('Updating', 'Updating'),
    ('UninstallConfirm', 'UninstallConfirm'),
    ('UninstallProgress', 'UninstallProgress'),
    ('UninstallDone', 'UninstallDone'),
]

# Languages chosen for what they do to a layout, not for their size: German
# for its long compounds, Japanese for dense glyphs, Arabic for right-to-left,
# Thai for tall marks, Greek for a third alphabet.
LANGUAGES = [
    ('ru', 'Русский'), ('en', 'English'), ('de', 'Deutsch'),
    ('el', 'Ελληνικά'), ('ja', '日本語'), ('ar', 'العربية'), ('th', 'ไทย'),
]

RU = json.load(io.open(os.path.join(STRINGS, 'ru.json'), encoding='utf-8'))


def artboard(page_file, code, native):
    source = io.open(os.path.join(DESIGN, page_file + '.dc.html'), encoding='utf-8').read()
    strings = json.load(io.open(os.path.join(STRINGS, code + '.json'), encoding='utf-8'))

    # Longest first: "Удалить также настройки…" must not be eaten by "Удалить".
    for key in sorted(RU, key=lambda k: -len(RU[k])):
        russian = RU[key].replace('{v}', '1.0.0')
        if russian in source:
            source = source.replace(russian, strings[key].replace('{v}', VERSION))

    source = source.replace('1.0.0', VERSION)
    source = source.replace('73 из 118 МБ', '73 / 118 MB')
    # The pill's name and the words the installer draws live are invisible in
    # the baked art; on the canvas they are the whole point.
    source = source.replace('color: transparent; min-width: 84px;',
                            'color: rgba(242, 243, 247, 0.72); min-width: 84px;')
    source = source.replace('Русский</span>', native + '</span>')
    source = re.sub(r'\s+data-nsis-hide', '', source)
    if code == 'ar':
        source = source.replace('<div style="position: relative; width: 640px;',
                                '<div dir="rtl" style="position: relative; width: 640px;', 1)
    return source


def main(out):
    os.makedirs(out, exist_ok=True)
    boards = []
    for row, (code, native) in enumerate(LANGUAGES):
        for column, (page_file, page_name) in enumerate(PAGES):
            name = '%s%s' % (page_name, code.replace('-', ''))
            if row == 0 and column == 0:
                name = 'Main'
            io.open(os.path.join(out, name + '.dc.html'), 'w',
                    encoding='utf-8', newline='\n').write(artboard(page_file, code, native))
            boards.append({'file': name + '.dc.html', 'title': '%s · %s' % (native, page_name),
                           'x': column * 760, 'y': row * 520, 'w': 640, 'h': 400})
    canvas = {'artboards': boards, 'launch': {'view': 'canvas'}}
    io.open(os.path.join(out, 'canvas.json'), 'w', encoding='utf-8', newline='\n').write(
        json.dumps(canvas, ensure_ascii=False, indent=2) + '\n')
    print(len(boards), 'artboards')


if __name__ == '__main__':
    main(sys.argv[1])
