// Builds WoWSims from a tbc-new checkout with our fixes applied (wowsims-patches/*.patch):
//  - the WebAssembly build the browser runs (web/public/sim/wowsim.wasm.gz + Go's wasm_exec.js),
//  - the command line tool in bin/ (for SIM_MODE=cli and the dev scripts), unless --wasm-only.
// Needs Go; protoc comes from npm.
//
// Usage: node scripts/build-wowsims.mjs <path-to-tbc-new-checkout> [--wasm-only]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const src = process.argv[2];
const wasmOnly = process.argv.includes('--wasm-only');
if (!src) {
  console.error('Usage: node scripts/build-wowsims.mjs <path-to-tbc-new-checkout>');
  process.exit(1);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: src, stdio: 'inherit', ...opts });
const exe = process.platform === 'win32' ? '.exe' : '';

// Patches: skip ones that are already applied.
for (const file of fs.readdirSync('wowsims-patches').filter((f) => f.endsWith('.patch')).sort()) {
  const patch = path.resolve('wowsims-patches', file);
  try {
    run('git', ['apply', '--check', patch], { stdio: 'pipe' });
    run('git', ['apply', patch]);
    console.log(`applied ${file}`);
  } catch {
    run('git', ['apply', '--reverse', '--check', patch], { stdio: 'pipe' });
    console.log(`already applied ${file}`);
  }
}

// The generated protobuf code isn't committed upstream.
const protoc = path.resolve('node_modules/@protobuf-ts/protoc/protoc.js');
const protos = fs.readdirSync(path.join(src, 'proto')).filter((f) => f.endsWith('.proto')).map((f) => `proto/${f}`);
run(process.execPath, [protoc, '-I=./proto', '--go_opt=Mgoogle/protobuf/descriptor.proto=google.golang.org/protobuf/types/descriptorpb', '--go_out=./sim/core', ...protos]);

// WebAssembly for the browser, with the item database built in (with_db), gzipped (42 MB -> 7 MB).
const simDir = path.resolve('web/public/sim');
fs.mkdirSync(simDir, { recursive: true });
const wasm = path.resolve('.cache', 'wowsim.wasm');
fs.mkdirSync(path.dirname(wasm), { recursive: true });
run('go', ['build', '--tags=with_db', '-ldflags', '-w -s', '-o', wasm, './sim/wasm/'], {
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm', GOWASM: 'satconv,signext' },
});
fs.writeFileSync(path.join(simDir, 'wowsim.wasm.gz'), zlib.gzipSync(fs.readFileSync(wasm), { level: 9 }));
fs.rmSync(wasm);
// Go's loader for its WebAssembly output (moved from misc/wasm to lib/wasm in Go 1.24).
const goroot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
const execJs = [path.join(goroot, 'lib/wasm/wasm_exec.js'), path.join(goroot, 'misc/wasm/wasm_exec.js')].find((f) => fs.existsSync(f));
fs.copyFileSync(execJs, path.join(simDir, 'wasm_exec.js'));
console.log(`built ${path.join(simDir, 'wowsim.wasm.gz')}`);

if (!wasmOnly) {
  fs.mkdirSync('bin', { recursive: true });
  const out = path.resolve('bin', `wowsimcli${exe}`);
  // Same flags as the upstream release build; with_db embeds the item database.
  run('go', ['build', '--tags=with_db', '-o', out, './cmd/wowsimcli'], { env: { ...process.env, GOAMD64: 'v2' } });
  console.log(`built ${out}`);
}
