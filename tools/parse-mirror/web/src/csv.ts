// CSV download for tables (opens in Excel / Google Sheets), with semicolons and decimal commas as
// Danish Excel expects.
export function csvText(rows: (string | number | undefined)[][]) {
  const cell = (v: string | number | undefined) => {
    const s = v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 10) / 10).replace('.', ',') : v;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel reads the UTF-8 names (Nuttý, Darkfadè) correctly.
  return '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const blob = new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
