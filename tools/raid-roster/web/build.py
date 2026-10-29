# Builds NP Roster as a static site for GitHub Pages, running on Firebase instead of claude.ai.
#   python3 build.py <site dir>          the tool goes to <site dir>/raid-roster/
#   python3 build.py <site dir> --fake   uses fake-firebase.js instead of Firebase, for local tests
import pathlib
import shutil
import sys

FIREBASE = '10.12.2'
here = pathlib.Path(__file__).resolve().parent
tool = here.parent
site = pathlib.Path(sys.argv[1])
fake = '--fake' in sys.argv
out = site / 'raid-roster'

if not fake and not (here / 'firebase-config.js').exists():
    sys.exit('firebase-config.js is missing: copy firebase-config.example.js and fill in the values from the Firebase console.')

shutil.rmtree(out, ignore_errors=True)
out.mkdir(parents=True)
shutil.copytree(tool / 'icons', out / 'icons')
for name in ['core.js', 'app.js']:
    shutil.copy(tool / name, out / name)
for name in ['firebase-backend.js', 'firebase.css'] + (['fake-firebase.js'] if fake else ['firebase-config.js']):
    shutil.copy(here / name, out / name)

sdk = ['fake-firebase.js'] if fake else [
    f'https://www.gstatic.com/firebasejs/{FIREBASE}/firebase-{part}-compat.js' for part in ['app', 'auth', 'firestore']
] + ['firebase-config.js']
head = '\n'.join([
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<link rel="icon" href="icons/emblem.png">',
    '<link rel="stylesheet" href="firebase.css">',
    *[f'<script src="{src}"></script>' for src in sdk],
    '<script src="firebase-backend.js"></script>',
    '</head>',
    '<body>',
])
page = (tool / 'np-roster.html').read_text(encoding='utf-8')
(out / 'index.html').write_text(head + '\n' + page + '\n</body>\n</html>\n', encoding='utf-8')

# The site root sends visitors on to the tool.
(site / 'index.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=raid-roster/"><title>NP Roster</title><a href="raid-roster/">NP Roster</a>\n', encoding='utf-8')
print(f'Built {out}')
