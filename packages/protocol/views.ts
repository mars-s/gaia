import { z } from "zod";
import { Cell, FileRef, FileSha, fileLimits } from "./files.ts";

const Id = z.string().min(1).max(120);
const Label = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (s) => !/[\u2013\u2014!<>]/u.test(s),
    "Use plain sentence case labels.",
  );
export const Bind = z.union([
  z.strictObject({ query: Id, field: Id.optional() }),
  z.strictObject({ quote: Id }),
]);
export const TableQuery = z.strictObject({
  id: Id,
  file: FileSha,
  filter: z
    .array(
      z.strictObject({
        field: Id,
        op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]),
        value: Cell,
      }),
    )
    .max(20)
    .default([]),
  groupBy: z.array(Id).max(6).default([]),
  aggregate: z
    .array(
      z.strictObject({
        field: Id.optional(),
        op: z.enum(["count", "sum", "mean", "min", "max"]),
        as: Id,
      }),
    )
    .max(12)
    .default([]),
  bin: z
    .strictObject({ field: Id, unit: z.enum(["week", "month", "year"]) })
    .optional(),
  sort: z
    .array(z.strictObject({ field: Id, direction: z.enum(["asc", "desc"]) }))
    .max(6)
    .default([]),
  limit: z.number().int().min(1).max(500).default(500),
});
export type TableQuery = z.infer<typeof TableQuery>;
export const Quote = z.strictObject({
  id: Id,
  file: FileSha,
  text: z.string().min(1).max(4000),
  span: z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
});
export const ViewNode = z.strictObject({
  key: Id,
  type: Id,
  props: z.record(z.string(), z.unknown()),
  alt: Label,
  get children() {
    return z.array(ViewNode).max(8).optional();
  },
});
export const ViewSpec = z.strictObject({
  version: z.literal(1),
  id: Id,
  revision: z.number().int().positive(),
  intent: z.string().min(1).max(4000),
  title: Label.max(60),
  files: z.array(FileRef).max(fileLimits.count),
  queries: z.array(TableQuery).max(8),
  quotes: z.array(Quote).max(32),
  root: ViewNode,
  followUps: z.array(Label).max(3),
});
export type ViewSpec = z.infer<typeof ViewSpec>;
