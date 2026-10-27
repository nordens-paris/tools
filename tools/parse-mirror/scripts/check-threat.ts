// Checks the tank threat values in server/specs/tanks.ts against a WoWSims checkout: each value's
// literal must still be in the WoWSims file it was copied from. Run after updating WoWSims.
// Usage: npx tsx scripts/check-threat.ts <path-to-tbc-new-checkout>
import fs from 'node:fs';
import path from 'node:path';

import { tankSpecs } from '../server/specs/tanks.ts';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npx tsx scripts/check-threat.ts <path-to-tbc-new-checkout>');
  process.exit(1);
}
let bad = 0;
const check = (spec: string, what: string, file: string, literal: string) => {
  const text = fs.readFileSync(path.join(src, 'sim', file), 'utf8');
  const ok = text.includes(literal);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'GONE'} ${spec.padEnd(20)} ${what.padEnd(22)} sim/${file}: ${literal}`);
};
for (const s of tankSpecs) {
  check(s.label, s.tankAura.name.join('/'), s.tankAura.src, s.tankAura.check);
  if (s.talent) check(s.label, s.talent.name, s.talent.src, s.talent.check);
  if (s.holyMult) check(s.label, 'Righteous Fury', s.holyMult.src, s.holyMult.check);
  for (const [name, r] of Object.entries(s.spells)) check(s.label, name, r.src, r.check);
}
console.log(bad ? `\n${bad} value(s) changed in WoWSims: update server/specs/tanks.ts.` : '\nAll threat values match WoWSims.');
process.exit(bad ? 1 : 0);
