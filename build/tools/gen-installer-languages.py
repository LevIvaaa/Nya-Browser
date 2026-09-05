# -*- coding: utf-8 -*-
"""Regenerates the installer's language popup and system-language names from
the browser's own LANGUAGES table, so the two lists can never drift apart."""
import io, os, re

NSH = r'C:\Dev\Nya-Browser\build\installer.nsh'
TS = r'C:\Dev\Nya-Browser\src\shared\i18n.ts'

langs = re.findall(r"\{ code: '([\w-]+)', name: '([^']+)' \}", io.open(TS, encoding='utf-8').read())
assert len(langs) == 65, len(langs)

# Windows primary language ids (LANG_*), the country half masked off. Only the
# languages we actually ship a dictionary for; anything else falls to English.
PRIMARY = {
    'ar': 0x01, 'bg': 0x02, 'ca': 0x03, 'zh-CN': 0x04, 'cs': 0x05, 'da': 0x06,
    'de': 0x07, 'el': 0x08, 'en': 0x09, 'es': 0x0A, 'fi': 0x0B, 'fr': 0x0C,
    'he': 0x0D, 'hu': 0x0E, 'is': 0x0F, 'it': 0x10, 'ja': 0x11, 'ko': 0x12,
    'nl': 0x13, 'no': 0x14, 'pl': 0x15, 'pt-BR': 0x16, 'ro': 0x18, 'ru': 0x19,
    'sr': 0x1A, 'sk': 0x1B, 'sq': 0x1C, 'sv': 0x1D, 'th': 0x1E, 'tr': 0x1F,
    'ur': 0x20, 'id': 0x21, 'be': 0x23, 'sl': 0x24, 'et': 0x25, 'lv': 0x26,
    'lt': 0x27, 'fa': 0x29, 'vi': 0x2A, 'hy': 0x2B, 'az': 0x2C, 'mk': 0x2F,
    'af': 0x36, 'ka': 0x37, 'fo': 0x38, 'hi': 0x39, 'ms': 0x3E, 'kk': 0x3F,
    'ky': 0x40, 'sw': 0x41, 'uz': 0x43, 'bn': 0x45, 'ta': 0x49, 'te': 0x4A,
    'mr': 0x4E, 'mn': 0x50, 'km': 0x53, 'gl': 0x56, 'si': 0x5B, 'am': 0x5E,
    'ne': 0x61, 'fil': 0x64,
}
# Sublanguage decides for these: full LCIDs.
FULL = [
    (2070, 'pt-PT'), (1028, 'zh-TW'), (3076, 'zh-TW'), (5124, 'zh-TW'),
    (1050, 'hr'), (5146, 'bs'), (8218, 'bs'),
]

name_of = dict(langs)

# The pill sizes itself to whatever it is given, so nothing needs shortening.
SHORT = {}
short_of = lambda code: SHORT.get(code, name_of[code])
MENUBARBREAK = 0x20
COLUMN_EVERY = 17

menu = ["    System::Call 'user32::CreatePopupMenu() p .R0'",
        '''    System::Call 'user32::AppendMenu(p R0, i 0, i 1, w "Язык системы")\'''',
        "    System::Call 'user32::AppendMenu(p R0, i 0x800, i 0, w \"\")'"]
cases = ['''      ${Case} 1
        StrCpy $nyaLang "system"
        Call nyaSystemLangName
        Pop $R5
        ${Break}''']

for i, (code, name) in enumerate(langs):
    ident = i + 2
    flag = MENUBARBREAK if i and i % COLUMN_EVERY == 0 else 0
    menu.append(
        "    System::Call 'user32::AppendMenu(p R0, i %s, i %d, w \"%s\")'"
        % (hex(flag) if flag else '0', ident, name))
    cases.append('''      ${Case} %d
        StrCpy $nyaLang "%s"
        StrCpy $R5 "%s"
        ${Break}''' % (ident, code, short_of(code)))

src = io.open(NSH, encoding='utf-8-sig').read().replace('\r\n', '\n')

# --- the popup itself
start = src.index("    System::Call 'user32::CreatePopupMenu() p .R0'")
end = src.index("\n\n    System::Call '*(i 0, i 0) p .R1'", start)
src = src[:start] + '\n'.join(menu) + src[end:]

# --- the switch that turns the picked id into a code and a label
start = src.index('    ${Switch} $R4')
end = src.index('    ${EndSwitch}', start)
src = (src[:start] + '    ${Switch} $R4\n' + '\n'.join(cases) +
       '\n      ${Default}\n        Return\n' + src[end:])

# --- the name shown before anyone picks anything
# The generated stretch starts at nyaLangNameOf on a file that already has one
# and at the system-name comment on a file that does not, so re-running this
# replaces the block instead of stacking another copy on top of it.
HEAD_MARK = '  ; The name of a language code, for the pill to open on whatever language'
head = src.index(HEAD_MARK) if HEAD_MARK in src else src.index('  ; What the pill says before anyone touches it')
tail = src.index('  ; A native popup with the language list')

full_cases = []
for lcid, code in FULL:
    full_cases.append('      ${Case} %d\n        StrCpy $nyaSysCode "%s"\n        Push "%s"\n        ${Break}' % (lcid, code, short_of(code)))
primary_cases = []
for code, pid in sorted(PRIMARY.items(), key=lambda kv: kv[1]):
    if code not in name_of:
        continue
    primary_cases.append('      ${Case} %d\n        StrCpy $nyaSysCode "%s"\n        Push "%s"\n        ${Break}' % (pid, code, short_of(code)))

name_cases = []
for code, name in langs:
    name_cases.append('      ${Case} "%s"\n        StrCpy $R9 "%s"\n        ${Break}' % (code, name))

block = '''  ; The name of a language code, for the pill to open on whatever language
  ; the browser is already set to. Anything unknown falls back to the system.
  Function nyaLangNameOf
    Exch $R9
    ${Switch} $R9
%s
      ${Default}
        StrCpy $R9 ""
        ${Break}
    ${EndSwitch}
    Exch $R9
  FunctionEnd

  ; What the pill says before anyone touches it:''' % (chr(10).join(name_cases)) + ''' the language the system
  ; already speaks. Only an explicit pick writes anything to the registry.
  ;
  ; Windows hands over a full LCID. A handful of languages need the country
  ; half to choose a dictionary — Brazilian against European Portuguese,
  ; simplified against traditional Chinese, the three that share one primary
  ; id in the Balkans — so those are matched whole and everything else is
  ; matched on the primary language alone.
  Function nyaSystemLangName
    StrCpy $nyaSysCode "en"
    ${Switch} $LANGUAGE
%s
      ${Default}
        Call nyaPrimaryLangName
        ${Break}
    ${EndSwitch}
  FunctionEnd

  Function nyaPrimaryLangName
    IntOp $R8 $LANGUAGE & 1023
    ${Switch} $R8
%s
      ${Default}
        Push "English"
        ${Break}
    ${EndSwitch}
  FunctionEnd''' % ('\n'.join(full_cases), '\n'.join(primary_cases))

src = src[:head] + block + chr(10) + chr(10) + src[tail:]

io.open(NSH, 'w', encoding='utf-8-sig', newline='\r\n').write(src)

lines = ['; Generated by build/tools/gen-installer-languages.py - do not edit.',
         '; One string file per language, unpacked beside the artwork.',
         '!macro NyaLangFiles']
for code in ['ru'] + [c for c, _ in langs if c != 'ru']:
    lines.append('  File "/oname=$PLUGINSDIR\\lang-' + code + '.ini" "${BUILD_RESOURCES_DIR}\\art\\lang-' + code + '.ini"')
lines.append('!macroend')
io.open(os.path.join(os.path.dirname(NSH), 'installer-langs.nsh'), 'w',
        encoding='utf-8', newline=chr(13) + chr(10)).write(chr(10).join(lines) + chr(10))
print('installer-langs.nsh:', len(lines) - 3, 'files')
print('menu entries:', len(langs), '| full-LCID cases:', len(FULL), '| primary cases:', len(primary_cases))
