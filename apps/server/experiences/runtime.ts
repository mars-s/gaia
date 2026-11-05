import { setupSidecars } from "./setup-sidecars.ts";
import { z } from "zod";
import { join, dirname } from "node:path";
import {
  ExperienceId,
  ExperienceCreate,
  ExperienceCapabilities,
  type ProposalMetadata,
} from "../../../packages/protocol/experiences.ts";
import {
  openProfile,
  type ProfileRuntime,
  type ProfileOptions,
} from "./profile.ts";
import { durableDirectory, profileDirectories } from "./storage.ts";
import { Capacity } from "./capacity.ts";
import { HttpError } from "../http-error.ts";

export type ExperienceRuntimeOptions = Omit<
  ProfileOptions,
  "capacity" | "capabilities"
> & {
  capabilities?:
    | Partial<z.infer<typeof ExperienceCapabilities>>
    | (() => Partial<z.infer<typeof ExperienceCapabilities>>);
  concurrency?: number;
};
export async function createExperienceRuntime(
  generation: string,
  options: ExperienceRuntimeOptions,
) {
  const directory = join(generation, "experiences");
  const sidecars = setupSidecars(directory);
  let mutations = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutations.then(operation);
    mutations = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  const profiles = new Map<ExperienceId, Promise<ProfileRuntime>>();
  const capabilities = () => ({
    machine: false,
    desktop: false,
    search: false,
    selfModification: false,
    ...(typeof options.capabilities === "function"
      ? options.capabilities()
      : options.capabilities),
  });
  const capacity = new Capacity(options.concurrency ?? 4);
  let open = true;
  durableDirectory(directory);
  durableDirectory(dirname(directory));
  function load(id: ExperienceId, path: string) {
    const pending = openProfile(path, id, {
      ...options,
      capabilities,
      capacity,
    });
    profiles.set(id, pending);
    return pending;
  }
  for (const profile of profileDirectories(directory))
    await load(profile.id, profile.path);
  const resolve = async (id: string) => {
    const parsed = ExperienceId.safeParse(id);
    const profile = parsed.success ? profiles.get(parsed.data) : undefined;
    if (!profile) throw new HttpError(404, "Unknown experience profile.");
    return profile;
  };
  return {
    get capabilities() {
      return capabilities();
    },
    resolve,
    async index() {
      const rows = await Promise.all(
        [...profiles.values()].map(async (pending) => {
          const state = await (await pending).state();
          const proposal = sidecars.proposal(state.profile.id);
          return {
            profile: { ...state.profile, ...(proposal ? { proposal } : {}) },
            date: state.scopes.map((s) => s.createdAt).sort()[0] ?? "",
          };
        }),
      );
      rows.sort(
        (a, b) =>
          (a.profile.proposal?.createdAt ?? a.date).localeCompare(
            b.profile.proposal?.createdAt ?? b.date,
          ) ||
          a.date.localeCompare(b.date) ||
          a.profile.id.localeCompare(b.profile.id),
      );
      return {
        version: 1 as const,
        profiles: rows.map((row) => row.profile),
        capabilities: capabilities(),
      };
    },
    async create(
      input: z.infer<typeof ExperienceCreate>,
      binding?: Pick<ProposalMetadata, "source" | "answerMessageId">,
    ) {
      return serial(async () => {
        if (!open) throw new HttpError(503, "Experience admission is closed.");
        const id = ExperienceId.parse(input.requestId);
        let profile = profiles.get(id);
        if (!profile) {
          const path = join(directory, id);
          durableDirectory(path);
          durableDirectory(directory);
          profile = load(id, path);
        }
        const value = await (await profile).initialise(input);
        let metadata = sidecars.proposal(id);
        if (!metadata) {
          metadata = {
            version: 1,
            createdAt: new Date().toISOString(),
            source: binding?.source ?? { kind: "manual" },
            ...(binding?.answerMessageId
              ? { answerMessageId: binding.answerMessageId }
              : {}),
          };
          sidecars.saveProposal(id, metadata);
          if (metadata.source.kind === "conversation") {
            const conversationId = metadata.source.conversationId;
            for (const [otherId, pending] of profiles) {
              if (otherId === id) continue;
              const older = sidecars.proposal(otherId);
              if (
                older?.source.kind === "conversation" &&
                older.source.conversationId === conversationId &&
                !older.dismissedAt &&
                !older.supersededBy &&
                (await (await pending).state()).profile.kind === "proposed"
              )
                sidecars.saveProposal(otherId, { ...older, supersededBy: id });
            }
          }
        }
        return { ...value, proposal: metadata };
      });
    },
    async dismiss(id: string) {
      return serial(async () => {
        const profile = (await (await resolve(id)).state()).profile;
        if (profile.kind !== "proposed")
          throw new HttpError(409, "This setup is already created.");
        const metadata = sidecars.proposal(id) ?? {
          version: 1 as const,
          createdAt: new Date().toISOString(),
          source: { kind: "legacy" as const },
        };
        if (!metadata.dismissedAt)
          sidecars.saveProposal(id, {
            ...metadata,
            dismissedAt: new Date().toISOString(),
          });
        return { ...profile, proposal: sidecars.proposal(id) };
      });
    },
    main() {
      return sidecars.main();
    },
    async selectMain(profileId: ExperienceId | null) {
      return serial(async () => {
        if (
          profileId &&
          (await (await resolve(profileId)).state()).profile.kind !== "ready"
        )
          throw new HttpError(409, "Create this setup before making it main.");
        const previous = sidecars.main();
        if (previous.profileId === profileId) return previous;
        const value = {
          version: 1 as const,
          profileId,
          setAt: new Date().toISOString(),
        };
        sidecars.saveMain(value);
        return value;
      });
    },
    async busy() {
      const states = await Promise.all(
        [...profiles.values()].map(async (p) => (await p).busy()),
      );
      return {
        admissionOpen: open,
        jobs: states.reduce((sum, s) => sum + s.jobs, 0),
        operations: states.reduce((sum, s) => sum + s.operations, 0),
      };
    },
    async quiesce() {
      open = false;
      await Promise.all(
        [...profiles.values()].map(async (p) => (await p).quiesce()),
      );
      return { admissionOpen: false as const, jobs: 0, operations: 0 };
    },
    async close() {
      await this.quiesce();
      await Promise.all(
        [...profiles.values()].map(async (p) => (await p).close()),
      );
    },
  };
}
export type ExperienceRuntime = Awaited<
  ReturnType<typeof createExperienceRuntime>
>;
