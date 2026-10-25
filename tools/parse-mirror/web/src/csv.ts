// CSV download for tables (opens in Excel / Google Sheets).
export function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const cell = (v: string | number | undefined) => {
    const s = v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 10) / 10) : v;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel reads the UTF-8 names (Nuttý, Darkfadè) correctly.
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
