import { TableQuery, Quote } from "../../../packages/protocol/views.ts";
import type { Cell, ParsedFile } from "../../../packages/protocol/files.ts";

export function runQuery(
  input: unknown,
  file: ParsedFile,
): Record<string, Cell>[] {
  const query = TableQuery.parse(input);
  if (file.kind !== "csv") throw new Error("Table queries need a CSV file.");
  const columns = new Map(file.columns.map((c, i) => [c.name, i]));
  const index = (name: string) => {
    const value = columns.get(name);
    if (value === undefined) throw new Error(`Unknown column: ${name}`);
    return value;
  };
  const groups = query.groupBy.map((name) => ({ name, index: index(name) }));
  const filters = query.filter.map((f) => ({ ...f, index: index(f.field) }));
  const aggregates = query.aggregate.map((a) => {
    if (
      a.op !== "count" &&
      (!a.field || file.columns[index(a.field)].type !== "number")
    )
      throw new Error("Numeric aggregates need a number column.");
    return { ...a, index: a.field ? index(a.field) : undefined };
  });
  const aliases = aggregates.map((a) => a.as);
  if (
    new Set(aliases).size !== aliases.length ||
    aliases.some((a) => query.groupBy.includes(a))
  )
    throw new Error("Query output names must be unique.");
  const binIndex = query.bin ? index(query.bin.field) : undefined;
  if (
    query.bin &&
    (!query.groupBy.includes(query.bin.field) ||
      file.columns[binIndex!].type !== "date")
  )
    throw new Error("Date bins need a grouped date column.");
  function compare(a: Cell, b: Cell) {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    if (typeof a !== typeof b)
      throw new Error("Query comparisons need matching value types.");
    return a < b ? -1 : 1;
  }
  function bin(cell: Cell): Cell {
    if (cell === null) return null;
    const date = new Date(String(cell));
    if (!Number.isFinite(date.getTime()))
      throw new Error("This date cannot be grouped.");
    if (query.bin?.unit === "week")
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (query.bin?.unit === "month") date.setUTCDate(1);
    if (query.bin?.unit === "year") date.setUTCMonth(0, 1);
    return date.toISOString().slice(0, 10);
  }
  const rows = file.rows.filter((row) =>
    filters.every((f) => {
      const c = compare(row[f.index], f.value);
      switch (f.op) {
        case "eq":
          return c === 0;
        case "ne":
          return c !== 0;
        case "lt":
          return c < 0;
        case "lte":
          return c <= 0;
        case "gt":
          return c > 0;
        case "gte":
          return c >= 0;
      }
    }),
  );
  let output: Record<string, Cell>[];
  if (!groups.length && !aggregates.length)
    output = rows.map((row) =>
      Object.fromEntries(file.columns.map((c, i) => [c.name, row[i]])),
    );
  else {
    const buckets = new Map<string, { values: Cell[]; rows: Cell[][] }>();
    if (!groups.length) buckets.set("[]", { values: [], rows: [] });
    for (const row of rows) {
      const values = groups.map((g) =>
        g.index === binIndex ? bin(row[g.index]) : row[g.index],
      );
      const key = JSON.stringify(values);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { values, rows: [] };
        buckets.set(key, bucket);
      }
      bucket.rows.push(row);
    }
    output = Array.from(buckets.values(), (bucket) => {
      const result = Object.fromEntries(
        groups.map((g, i) => [g.name, bucket.values[i]]),
      );
      for (const a of aggregates) {
        const values =
          a.index === undefined
            ? []
            : bucket.rows
                .map((r) => r[a.index!])
                .filter((v): v is number => typeof v === "number");
        let value: number | null;
        if (a.op === "count")
          value =
            a.index === undefined
              ? bucket.rows.length
              : bucket.rows.filter((r) => r[a.index!] !== null).length;
        else if (!values.length) value = null;
        else if (a.op === "min")
          value = values.reduce((x, y) => Math.min(x, y));
        else if (a.op === "max")
          value = values.reduce((x, y) => Math.max(x, y));
        else {
          const sum = values.reduce((x, y) => x + y, 0);
          value = a.op === "mean" ? sum / values.length : sum;
        }
        if (value !== null && !Number.isFinite(value))
          throw new Error("The query result exceeds the number limit.");
        result[a.as] = value;
      }
      return result;
    });
  }
  const allowed = output.length
    ? Object.keys(output[0])
    : aggregates.length || groups.length
      ? [...query.groupBy, ...aliases]
      : file.columns.map((c) => c.name);
  if (query.sort.some((s) => !allowed.includes(s.field)))
    throw new Error("Sort needs an output column.");
  output.sort((a, b) => {
    for (const s of query.sort) {
      const c = compare(a[s.field], b[s.field]);
      if (c) return s.direction === "asc" ? c : -c;
    }
    return 0;
  });
  return output.slice(0, query.limit);
}

export function verifyQuote(input: unknown, file: ParsedFile) {
  const quote = Quote.parse(input);
  if (
    file.kind === "csv" ||
    quote.span.end <= quote.span.start ||
    file.text.slice(quote.span.start, quote.span.end) !== quote.text
  )
    throw new Error("This quote does not match the source file.");
  return quote;
}
