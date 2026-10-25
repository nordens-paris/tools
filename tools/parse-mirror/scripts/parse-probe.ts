// Dev helper: one character's parses, raw.
import { WclClient } from '../server/wcl/client.ts';
import { parsesFor } from '../server/analysis/characters.ts';
const [name, server, zone] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const r = await parsesFor(client, name, server, zone ? Number(zone) : undefined);
console.log(r.region, r.parses.length, JSON.stringify(r.parses[0]));
console.log([...new Set(r.parses.map((p) => p.encounterName))].join(', '));
