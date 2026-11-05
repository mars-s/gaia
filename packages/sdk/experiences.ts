import { z } from "zod";
import { ApiError, ModelSelection } from "../protocol/index.ts";
import { ImageUpload, AttachmentId } from "../protocol/attachments.ts";
import {
  Experience,
  ExperienceIndex,
  ExperienceState,
  ExperienceScopeState,
  ExperienceScope,
  ExperienceCreate,
  ExperienceConfirm,
  ExperienceSend,
  ExperienceAdmission,
  ExperienceJob,
  ExperienceRetry,
  ExperienceAttachment,
  ExperienceId,
  ScopeId,
  JobId,
  ScopePlan,
} from "../protocol/experiences.ts";

export interface ExperienceTransport {
  fetch: typeof fetch;
  events: (url: string) => {
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: ((event: Event) => void) | null;
    onopen: ((event: Event) => void) | null;
    addEventListener?(type: string, listener: EventListener): void;
    close(): void;
  };
}
const root = "/api/v1/experiences";
export function createExperienceClient(
  transport: ExperienceTransport = {
    fetch: (...args) => fetch(...args),
    events: (url) => new EventSource(url),
  },
) {
  const profile = (id: ExperienceId) => `${root}/${ExperienceId.parse(id)}`;
  const scope = (id: ExperienceId, sid: ScopeId) =>
    `${profile(id)}/scopes/${ScopeId.parse(sid)}`;
  async function request<T>(
    url: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    try {
      const response = await transport.fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const parsed = ApiError.safeParse(value);
        throw new Error(
          parsed.success
            ? parsed.data.error
            : "Gaia could not complete that request. Try again.",
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw new Error(
          "Gaia returned an unreadable response. Reconnect and try again.",
        );
      return parsed.data;
    } catch (cause) {
      if (cause instanceof SyntaxError)
        throw new Error(
          "Gaia returned an unreadable response. Reconnect and try again.",
          { cause },
        );
      if (cause instanceof TypeError)
        throw new Error(
          "Connection lost. Your draft is here. Reconnect and try again.",
          { cause },
        );
      if (signal?.aborted)
        throw new Error("Request cancelled. Your draft is here.", { cause });
      if (cause instanceof Error && cause.name === "TimeoutError")
        throw new Error(
          "Gaia took too long to respond. Your draft is here. Try again.",
          { cause },
        );
      throw cause;
    }
  }
  const scoped = (id: ExperienceId, sid: ScopeId) =>
    ExperienceScopeState.refine(
      (value) =>
        value.profileId === id &&
        value.scope.profileId === id &&
        value.scope.id === sid &&
        value.jobs.every((job) => job.profileId === id && job.scopeId === sid),
    );
  const state = (id: ExperienceId) =>
    ExperienceState.refine(
      (value) =>
        value.profile.id === id &&
        value.scopes.every((item) => item.profileId === id) &&
        value.jobs.every((job) => job.profileId === id),
    );
  const admission = (id: ExperienceId, sid?: ScopeId) =>
    ExperienceAdmission.refine(
      (value) => value.profileId === id && (!sid || value.scopeId === sid),
    );
  return {
    index: (signal?: AbortSignal) => request(root, ExperienceIndex, signal),
    create: (input: z.infer<typeof ExperienceCreate>, signal?: AbortSignal) =>
      request(root, Experience, signal, ExperienceCreate.parse(input)),
    state: (id: ExperienceId, signal?: AbortSignal) =>
      request(`${profile(id)}/state`, state(id), signal),
    confirm: (id: ExperienceId, revision: number, signal?: AbortSignal) =>
      request(
        `${profile(id)}/confirm`,
        state(id),
        signal,
        ExperienceConfirm.parse({ revision }),
      ),
    createScope: (
      id: ExperienceId,
      input: z.infer<typeof ScopePlan>,
      signal?: AbortSignal,
    ) =>
      request(
        `${profile(id)}/scopes`,
        ExperienceScope.refine((value) => value.profileId === id),
        signal,
        ScopePlan.parse(input),
      ),
    scope: (id: ExperienceId, sid: ScopeId, signal?: AbortSignal) =>
      request(`${scope(id, sid)}/state`, scoped(id, sid), signal),
    send: (
      id: ExperienceId,
      sid: ScopeId,
      input: ExperienceSend,
      signal?: AbortSignal,
    ) =>
      request(
        `${scope(id, sid)}/messages`,
        admission(id, sid),
        signal,
        ExperienceSend.parse(input),
      ),
    model: (
      id: ExperienceId,
      sid: ScopeId,
      input: ModelSelection,
      signal?: AbortSignal,
    ) =>
      request(
        `${scope(id, sid)}/model`,
        scoped(id, sid),
        signal,
        ModelSelection.parse(input),
      ),
    compact: (id: ExperienceId, sid: ScopeId, signal?: AbortSignal) =>
      request(`${scope(id, sid)}/compact`, scoped(id, sid), signal, {}),
    upload: (
      id: ExperienceId,
      sid: ScopeId,
      input: z.infer<typeof ImageUpload>,
      signal?: AbortSignal,
    ) =>
      request(
        `${scope(id, sid)}/attachments`,
        ExperienceAttachment,
        signal,
        ImageUpload.parse(input),
      ),
    attachmentUrl: (id: ExperienceId, sid: ScopeId, aid: string) =>
      `${scope(id, sid)}/attachments/${AttachmentId.parse(aid)}`,
    stop: (id: ExperienceId, jid: JobId, signal?: AbortSignal) =>
      request(
        `${profile(id)}/jobs/${JobId.parse(jid)}/stop`,
        ExperienceJob.refine(
          (value) => value.profileId === id && value.id === jid,
        ),
        signal,
        {},
      ),
    retry: (
      id: ExperienceId,
      jid: JobId,
      input: z.infer<typeof ExperienceRetry>,
      signal?: AbortSignal,
    ) =>
      request(
        `${profile(id)}/jobs/${JobId.parse(jid)}/retry`,
        admission(id),
        signal,
        ExperienceRetry.parse(input),
      ),
    subscribe(
      id: ExperienceId,
      sid: ScopeId,
      receive: (value: ExperienceScopeState) => void,
      offline: () => void,
    ) {
      let closed = false;
      let generation = 0;
      let revision = -1;
      let retry = 500;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
      let source: ReturnType<ExperienceTransport["events"]> | undefined;
      let recovery: AbortController | undefined;
      function fetchFresh(reportFailure = false) {
        recovery?.abort();
        clearTimeout(recoveryTimer);
        const requestController = new AbortController();
        recovery = requestController;
        recoveryTimer = setTimeout(() => requestController.abort(), 5000);
        void request(
          `${scope(id, sid)}/state`,
          scoped(id, sid),
          requestController.signal,
        )
          .then((value) => {
            if (
              !closed &&
              recovery === requestController &&
              !requestController.signal.aborted
            )
              accept(value);
          })
          .catch(() => {
            if (reportFailure && !closed && recovery === requestController)
              offline();
          })
          .finally(() => {
            if (recovery === requestController) clearTimeout(recoveryTimer);
          });
      }
      function accept(value: ExperienceScopeState) {
        if (!closed && value.revision >= revision) {
          revision = value.revision;
          receive(value);
        }
      }
      function connect() {
        if (closed) return;
        const token = ++generation;
        source = transport.events(`${scope(id, sid)}/events`);
        const active = () => !closed && token === generation;
        const reconnect = () => {
          if (!active()) return;
          generation++;
          clearTimeout(watchdog);
          source?.close();
          recovery?.abort();
          offline();
          fetchFresh();
          timer = setTimeout(connect, retry);
          retry = Math.min(10000, retry * 2);
        };
        const alive = () => {
          if (!active()) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(reconnect, 10000);
        };
        alive();
        source.addEventListener?.("heartbeat", alive);
        source.onopen = () => {
          if (!active()) return;
          alive();
          fetchFresh(true);
        };
        source.onmessage = (event) => {
          if (!active()) return;
          alive();
          try {
            const value = scoped(id, sid).parse(JSON.parse(event.data));
            retry = 500;
            accept(value);
          } catch {
            reconnect();
          }
        };
        source.onerror = reconnect;
      }
      connect();
      return () => {
        closed = true;
        generation++;
        source?.close();
        recovery?.abort();
        clearTimeout(timer);
        clearTimeout(watchdog);
        clearTimeout(recoveryTimer);
      };
    },
  };
}
export type ExperienceClient = ReturnType<typeof createExperienceClient>;
