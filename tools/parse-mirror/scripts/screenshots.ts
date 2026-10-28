// Takes the screenshots for the user guide in README.md (docs/billeder/), with the example logs.
// Needs the dev server running (npm run dev) and Chrome or Edge installed.
// Usage: npx tsx scripts/screenshots.ts [base-url]   (default http://localhost:5173)
// CHROME=<path> picks the browser.
import fs from 'node:fs';
import path from 'node:path';

import puppeteer, { type ElementHandle, type Page } from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = path.resolve('docs/billeder');
const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => !!p);

// The guild's example kills (public logs).
const WARLOCK = 'r=q1Jr4LdHVzycnGA9&f=40&s=19'; // Darkfadè, Destruction, Kaz'rogal
const WARRIOR = 'r=dqF8J9TbnCHQ4jgk&f=10&s=6'; // Nuttý, Fury, Rage Winterchill
const RAID = 'r=q1Jr4LdHVzycnGA9';
const HEALER = 'r=nbfHKZ2Ax6JghkjD&f=64&s=13'; // Sanctalux, Holy Paladin, Gurtogg Bloodboil
const TANK = 'r=nbfHKZ2Ax6JghkjD&f=64&s=30'; // Tinkywiinky, Protection Paladin, Gurtogg Bloodboil
const BEAR = 'r=nbfHKZ2Ax6JghkjD&f=114&s=4'; // Storbøf, bear, Archimonde (main tank: the opener is judged)
const HUNTER = 'r=nbfHKZ2Ax6JghkjD&f=101&s=9'; // Miracleprime, Beast Mastery, Kaz'rogal

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSERS.find((p) => fs.existsSync(p)),
  headless: true,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

async function open(query: string) {
  await page.goto(`${BASE}/${query ? `?${query}` : ''}`, { waitUntil: 'networkidle2' });
}

/** Waits until the analysis is shown and its sims are done. */
async function waitForSims() {
  await page.waitForSelector('.kpis', { timeout: 300_000 });
  await page.waitForFunction(() => !document.querySelector('.tabs .dot') && !document.body.innerText.includes('Simming…'), {
    timeout: 600_000,
    polling: 1000,
  });
}

async function tab(name: string) {
  await page.evaluate((n) => {
    [...document.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent?.startsWith(n))?.click();
  }, name);
  await new Promise((r) => setTimeout(r, 600));
}

/** Screenshot of the panel whose heading starts with `heading`. */
async function panel(file: string, heading: string) {
  const el = await page.evaluateHandle((h) => {
    const head = [...document.querySelectorAll('h2')].find((x) => x.textContent?.trim().startsWith(h));
    return head?.closest('section') ?? null;
  }, heading);
  const handle = el.asElement() as ElementHandle<Element> | null;
  if (!handle) throw new Error(`No panel "${heading}"`);
  // The sticky top bar would cover the top of panels taller than the window.
  await page.addStyleTag({ content: 'header.top { visibility: hidden !important; }' }).then((tag) => tag.evaluate((t) => t.setAttribute('data-shot', '1')));
  await handle.scrollIntoView();
  await handle.screenshot({ path: path.join(OUT, file) });
  await page.evaluate(() => document.querySelectorAll('style[data-shot]').forEach((t) => t.remove()));
  log(file);
}

/** Screenshot of the visible window (optionally a taller one). */
async function view(file: string, height = 900) {
  await page.setViewport({ width: 1440, height, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, file) });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  log(file);
}

async function click(text: string, selector = 'button') {
  await page.evaluate(
    (t, s) => [...document.querySelectorAll<HTMLElement>(s)].find((b) => b.textContent?.includes(t))?.click(),
    text,
    selector,
  );
  await new Promise((r) => setTimeout(r, 600));
}

async function shots(page: Page) {
  void page;
  log('Landing page');
  await open('');
  await view('01-forside.png', 820);

  log('Warlock kill vs top 10 (waits for the sims)');
  await open(WARLOCK);
  await waitForSims();
  await view('02-overblik.png', 1250);
  await panel('03-fund.png', 'What to look at');

  await tab('Rotation');
  await panel('04-huller.png', 'Gaps between casts');
  await panel('05-casts.png', 'Casts per minute');

  await tab('Sim');
  await panel('06-held.png', 'Was it luck?');
  await click('What changed', 'summary');
  await panel('07-whatif.png', 'What would change your DPS?');
  await panel('08-forskel.png', 'Where the DPS difference');
  await click('Execution');
  await panel('09-execution.png', 'Where the DPS difference');

  await tab('Gear');
  await panel('10-hit.png', 'Hit chance');
  await panel('11-gear.png', 'Gear vs');

  await tab('Players');
  await panel('12-spillere.png', 'Compared players');

  log('Warrior kill: cooldowns and consumables');
  await open(`${WARRIOR}&tab=Cooldowns`);
  await waitForSims();
  await panel('13-cooldowns.png', 'Cooldown timing');
  await tab('Consumes');
  await click('every player');
  await panel('14-consumables.png', 'Consumables');

  log('Same gear, a step ahead');
  await open(`${WARRIOR}&vs=peers`);
  await waitForSims();
  await view('15-peers.png', 700);

  log('Hunter: pet in the header and in luck');
  await open(HUNTER);
  await waitForSims();
  await view('32-hunter.png', 640);
  await tab('Sim');
  await panel('33-hunter-luck.png', 'Was it luck?');

  log('Healer: Holy Paladin on Bloodboil');
  await open(HEALER);
  await page.waitForSelector('.kpis', { timeout: 300_000 });
  await view('21-healer.png', 1400);
  await tab('Mana');
  await panel('22-healer-mana.png', 'Mana over the kill');
  await tab('Overheal');
  await panel('23-healer-overheal.png', 'Overheal by cause');
  await tab('Deaths');
  await panel('24-healer-deaths.png', 'Deaths');

  log('Tank: Protection Paladin on Bloodboil');
  await open(TANK);
  await page.waitForSelector('.kpis', { timeout: 300_000 });
  await view('26-tank.png', 1400);
  await tab('Swings');
  await panel('27-tank-swings.png', 'How the boss');
  await tab('Threat');
  await panel('28-tank-threat.png', 'Threat');
  await tab('Sim');
  await page.waitForSelector('.setup-notes', { timeout: 600_000 });
  await panel('31-tank-sim.png', 'Threat next to what your gear can do');
  await open(`${BEAR}&tab=Threat`);
  await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Your opener'), { timeout: 300_000 });
  await panel('30-tank-opener.png', 'Your opener');

  log('Raid, progress and guild overviews');
  await open(`${RAID}&s=19`);
  await page.waitForSelector('h2', { timeout: 300_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Boss kills'), { timeout: 300_000 });
  await view('16-raid.png', 1500);
  await open(`${RAID}&s=19&p=1`);
  await page.waitForFunction(() => document.body.innerText.includes('Every boss'), { timeout: 300_000 });
  await view('17-progress.png', 1000);
  await open(RAID);
  await page.waitForFunction(() => document.body.innerText.includes('Everyone, every boss'), { timeout: 300_000 });
  await view('18-guild.png', 1000);
  // Debuffs and gear check sit side by side; shoot the row they share.
  await row('19-debuffs-gear.png', 'Debuffs on the boss');
  await panel('20-parties.png', 'Parties');
  await click('Show healers');
  await page.waitForFunction(() => document.body.innerText.includes('Healing per mana'), { timeout: 300_000 });
  await panel('25-healers.png', 'Healers');
  await click('Show tanks');
  await page.waitForFunction(() => document.body.innerText.includes('Holy Shield / Shield Block'), { timeout: 300_000 });
  await panel('29-tanks.png', 'Tanks');
}

/** Screenshot of the grid row holding the panel whose heading starts with `heading`. */
async function row(file: string, heading: string) {
  const el = await page.evaluateHandle((h) => {
    const head = [...document.querySelectorAll('h2')].find((x) => x.textContent?.trim().startsWith(h));
    return head?.closest('.grid-2') ?? null;
  }, heading);
  const handle = el.asElement() as ElementHandle<Element> | null;
  if (!handle) throw new Error(`No row with "${heading}"`);
  await page.addStyleTag({ content: 'header.top { visibility: hidden !important; }' }).then((tag) => tag.evaluate((t) => t.setAttribute('data-shot', '1')));
  await handle.scrollIntoView();
  await handle.screenshot({ path: path.join(OUT, file) });
  await page.evaluate(() => document.querySelectorAll('style[data-shot]').forEach((t) => t.remove()));
  log(file);
}

try {
  await shots(page);
} finally {
  await browser.close();
}
