// Builds the Windows package for a guild release: dist-windows/parse-mirror-windows.zip with two
// files at the top ("Start Parse Mirror.bat", "Opdater Parse Mirror.bat") and the tool in app/:
// the committed files, the browser sim (web/public/sim/wowsim.wasm.gz) and the command-line sim
// (bin/wowsimcli.exe, so sims run on the pc's own cores). windows/start.ps1 does the rest on the
// guildmate's pc: Node.js, the Warcraft Logs key, npm ci, build, start. See docs/drift.md.
//
//   node scripts/package-windows.mjs <release tag, parse-mirror-v<package.json version>>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tag = process.argv[2];
if (!/^parse-mirror-v[\d.]+$/.test(tag ?? '')) throw new Error('Usage: node scripts/package-windows.mjs parse-mirror-vX.Y');
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (tag !== `parse-mirror-v${version}`) throw new Error(`package.json has ${version}: the tag should be parse-mirror-v${version}`);
for (const file of ['bin/wowsimcli.exe', 'web/public/sim/wowsim.wasm.gz']) {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: build it with scripts/build-wowsims.mjs`);
}
if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) console.warn('Uncommitted changes are left out: the package has HEAD.');

const out = path.resolve('dist-windows');
const top = path.join(out, 'Parse Mirror');
const app = path.join(top, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
// Windows' own tar (bsdtar) reads git's tar and writes the zip.
const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execSync(`git archive --format=tar HEAD | "${tar}" -x -C "${app}"`, { stdio: 'inherit', shell: true });
fs.mkdirSync(path.join(app, 'bin'), { recursive: true });
fs.copyFileSync('bin/wowsimcli.exe', path.join(app, 'bin', 'wowsimcli.exe'));
fs.writeFileSync(path.join(app, 'VERSION'), `${tag}\n`);
for (const bat of ['Start Parse Mirror.bat', 'Opdater Parse Mirror.bat']) fs.copyFileSync(path.join('windows', bat), path.join(top, bat));
const zip = path.join(out, 'parse-mirror-windows.zip');
execSync(`"${tar}" -a -c -f "${zip}" -C "${out}" "Parse Mirror"`, { stdio: 'inherit' });
console.log(`${zip}: ${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB`);
