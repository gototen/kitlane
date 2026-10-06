export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export function table<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((r) => columns.map((c) => String(c.value(r) ?? "")));
  const widths = columns.map((c, i) => Math.max(c.header.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) =>
    vals
      .map((v, i) => (columns[i].align === "right" ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  const out = [line(columns.map((c) => c.header)), line(widths.map((w) => "-".repeat(w)))];
  for (const row of cells) out.push(line(row));
  return out.join("\n");
}

export function println(text = ""): void {
  process.stdout.write(text + "\n");
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function warn(text: string): void {
  process.stderr.write(text + "\n");
}
