import { median } from '../../server/analysis/stats.ts';
import { game } from './game.ts';

/** The median, or undefined with nothing to take it of. */
export const medianOf = (xs: number[]) => (xs.length ? median(xs) : undefined);

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtSigned = (n: number, digits = 0) => {
  // Something that rounds to zero shows as ±0, not −0.
  const shown = Number(Math.abs(n).toFixed(digits));
  return (shown === 0 ? '±' : n > 0 ? '+' : '−') + fmt(Math.abs(n), digits);
};

/** Spec names as Warcraft Logs writes them in icons ("BeastMastery"), spaced for reading. */
export const specLabel = (specName: string) => specName.replace(/([a-z])([A-Z])/g, '$1 $2');

/** A raid's date in the visitor's own format, e.g. "Tue, 16 Sep 2026". */
export const fmtDate = (epochMs: number) => new Date(epochMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (sec: number) => {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const abilityIcon = (icon?: string) =>
  icon ? `https://assets.rpglogs.com/img/warcraft/abilities/${icon}` : undefined;

export const itemIcon = (icon: string) => `https://wow.zamimg.com/images/wow/icons/medium/${icon}.jpg`;

/** Log icons come as "name.jpg" (Warcraft Logs' copy); bare names are Wowhead icon names. */
export const anyIcon = (icon: string) => (icon.endsWith('.jpg') ? abilityIcon(icon)! : itemIcon(icon));

export const wclReportUrl = (report: string) => `https://${game.wclHost}/reports/${report}`;

export const wclUrl = (report: string, fight: number, source?: number) =>
  `${wclReportUrl(report)}?fight=${fight}${source ? `&source=${source}&type=damage-done` : ''}`;

export const wowheadItem = (id: number, enchant?: number, gems: number[] = []) => {
  const params = [enchant ? `ench=${enchant}` : '', gems.length ? `gems=${gems.join(':')}` : ''].filter(Boolean).join('&');
  return `https://www.wowhead.com/${game.wowheadPath}/item=${id}${params ? `?${params}` : ''}`;
};

export const QUALITY_CLASS = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'];
