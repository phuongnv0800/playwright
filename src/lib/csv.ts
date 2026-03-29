function escapeCsvValue(value: unknown): string {
  const rendered = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(rendered)) {
    return `"${rendered.replace(/"/g, "\"\"")}"`;
  }
  return rendered;
}

export function renderCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = [...rows.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>())];

  const lines = rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(","));
  return [headers.join(","), ...lines].join("\n");
}
