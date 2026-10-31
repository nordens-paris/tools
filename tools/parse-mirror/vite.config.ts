import crypto from 'node:crypto';
import fs from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browsers keep the sim for a day; a new build gets a new URL by itself.
const simHash = crypto.createHash('sha1');
// The guild repo has no wowsim.wasm.gz until it's fetched, so a missing file is fine here.
for (const file of ['wowsim.wasm.gz', 'worker.js', 'wasm_exec.js']) if (fs.existsSync(`web/public/sim/${file}`)) simHash.update(fs.readFileSync(`web/public/sim/${file}`));

export default defineConfig({
  root: 'web',
  define: { __SIM_VERSION__: JSON.stringify(simHash.digest('hex').slice(0, 12)) },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:5174' },
    fs: { allow: ['..'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
