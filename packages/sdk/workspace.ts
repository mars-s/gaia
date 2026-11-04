import { z } from "zod";

const Purpose = z.string().trim().min(1).max(1000);
const AreaDescription = z.strictObject({
  label: z.string().trim().min(1).max(100),
  purpose: Purpose,
});
function distinctAreas(
  areas: z.infer<typeof AreaDescription>[],
  ctx: z.RefinementCtx,
) {
  for (const key of ["label", "purpose"] as const) {
    const values = areas.map((area) => area[key].toLocaleLowerCase("en-AU"));
    if (new Set(values).size !== values.length)
      ctx.addIssue({
        code: "custom",
        message: `Area ${key}s must be distinct.`,
      });
  }
}
const AreaList = z
  .array(AreaDescription)
  .min(2)
  .max(12)
  .superRefine(distinctAreas);

export const AreaId = z.uuid().brand<"WorkspaceAreaId">();
export type AreaId = z.infer<typeof AreaId>;
export const WorkspacePlan = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("single"), purpose: Purpose }),
  z.strictObject({ kind: z.literal("multi"), areas: AreaList }),
]);
export type WorkspacePlan = z.infer<typeof WorkspacePlan>;
export const WorkspaceRequest = z.strictObject({
  plan: WorkspacePlan,
  sharedPreferences: z.array(z.string().trim().min(1).max(500)).max(20),
});
export type WorkspaceRequest = z.infer<typeof WorkspaceRequest>;
export const WorkspaceArea = AreaDescription.extend({ areaId: AreaId });
export type WorkspaceArea = z.infer<typeof WorkspaceArea>;
export const Workspace = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("single"), purpose: Purpose }),
  z.strictObject({
    kind: z.literal("multi"),
    areas: z
      .array(WorkspaceArea)
      .min(2)
      .max(12)
      .superRefine(distinctAreas)
      .refine(
        (areas) =>
          new Set(areas.map((area) => area.areaId)).size === areas.length,
        "Area IDs must be distinct.",
      ),
  }),
]);
export type Workspace = z.infer<typeof Workspace>;
export const WorkspaceConfirmation = z.strictObject({
  proposalId: z.uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type WorkspaceConfirmation = z.infer<typeof WorkspaceConfirmation>;
export const WorkspaceProposal = WorkspaceConfirmation.extend({
  workspace: Workspace,
  sharedPreferences: WorkspaceRequest.shape.sharedPreferences,
});
export type WorkspaceProposal = z.infer<typeof WorkspaceProposal>;
export const WorkspaceState = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("proposed"), proposal: WorkspaceProposal }),
  z.strictObject({ kind: z.literal("confirmed"), proposal: WorkspaceProposal }),
]);
export type WorkspaceState = z.infer<typeof WorkspaceState>;
