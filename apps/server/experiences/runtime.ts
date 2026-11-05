import { z } from "zod";
import { join, dirname } from "node:path";
import {
  ExperienceId,
  ExperienceCreate,
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
  capabilities?: Partial<ProfileOptions["capabilities"]>;
  concurrency?: number;
};
export async function createExperienceRuntime(
  generation: string,
  options: ExperienceRuntimeOptions,
) {
  const directory = join(generation, "experiences");
  const profiles = new Map<ExperienceId, Promise<ProfileRuntime>>();
  const capabilities = {
    machine: false,
    desktop: false,
    search: false,
    selfModification: false,
    ...options.capabilities,
  };
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
    capabilities,
    resolve,
    async index() {
      return {
        version: 1 as const,
        profiles: (
          await Promise.all(
            [...profiles.values()].map(
              async (pending) => (await (await pending).read()).profile,
            ),
          )
        ).filter((p) => p !== null),
        capabilities,
      };
    },
    async create(input: z.infer<typeof ExperienceCreate>) {
      if (!open) throw new HttpError(503, "Experience admission is closed.");
      const id = ExperienceId.parse(input.requestId);
      let profile = profiles.get(id);
      if (!profile) {
        const path = join(directory, id);
        durableDirectory(path);
        durableDirectory(directory);
        profile = load(id, path);
      }
      return (await profile).initialise(input);
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
