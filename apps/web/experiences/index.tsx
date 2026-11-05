import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../components/base/buttons/button";
import {
  ExperiencePlan,
  type ExperienceLayout,
} from "../../../packages/protocol/experiences.ts";
import type { ExperienceController } from "./controller";
import { BotAvatar, ExperienceConversation } from "./view";

const layouts: Record<
  ExperienceLayout,
  { label: string; description: string }
> = {
  single: {
    label: "Central chat",
    description:
      "One conversation. Independent requests can continue together.",
  },
  bots: {
    label: "Bots",
    description:
      "Named Bots with separate roles, conversations and memory. Include Home to coordinate work.",
  },
  channels: {
    label: "Channels",
    description: "One assistant with shared memory and separate topic threads.",
  },
  sessions: {
    label: "Sessions",
    description:
      "Separate conversations, memory and model settings. Start fresh with New session.",
  },
};
export function ProfileExperience({
  controller,
  manage,
  onOpen,
  onBack,
  onSetup,
  onManage,
}: {
  controller: ExperienceController;
  manage: boolean;
  onOpen: () => void;
  onBack: () => void;
  onSetup?: () => void;
  onManage?: () => void;
}) {
  useSyncExternalStore(controller.subscribe, controller.version);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (manage) void controller.refresh();
  }, [controller, manage]);
  const profile = controller.profile?.profile;
  if (!manage && profile?.kind === "ready")
    return (
      <ExperienceConversation controller={controller} onProfiles={onManage} />
    );
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <section className="mx-auto flex w-full max-w-lg flex-col items-start gap-6">
        <div className="flex w-full items-center justify-between gap-3">
          <h1 className="text-title-3-semibold">Profiles</h1>
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              active.current = false;
              controller.original();
              onBack();
            }}
          >
            Original chat
          </Button>
        </div>
        <p className="text-text-secondary">
          Tell Gaia how you want to work, then review its proposed setup.
        </p>
        {controller.error && (
          <p role="alert" className="text-text-error-primary">
            {controller.error}{" "}
            <button
              className="quiet-link"
              onClick={() => void controller.refresh()}
            >
              Retry
            </button>
          </p>
        )}
        <div className="flex w-full flex-col gap-2">
          {controller.profiles.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="justify-between"
              disabled={pending}
              onClick={() => {
                setCreating(false);
                void controller.selectProfile(item.id).then(() => {
                  if (
                    active.current &&
                    controller.profile?.profile.id === item.id &&
                    controller.profile.profile.kind === "ready"
                  )
                    onOpen();
                });
              }}
            >
              <span className="truncate">{item.plan.title}</span>
              <span className="text-caption-1-regular text-text-secondary">
                {item.kind === "proposed"
                  ? "Review proposal"
                  : layouts[item.plan.layout].label}
              </span>
            </Button>
          ))}
        </div>
        {controller.loading && (
          <p role="status" className="text-text-secondary">
            Loading profile…
          </p>
        )}
        {profile?.kind === "proposed" && !creating && (
          <section
            className="flex w-full flex-col gap-4"
            aria-label="Review exact profile proposal"
          >
            <h2 className="text-body-medium">{profile.plan.title}</h2>
            <p>
              {layouts[profile.plan.layout].label} ·{" "}
              {profile.plan.assistantName}
            </p>
            <p className="whitespace-pre-wrap">{profile.plan.purpose}</p>
            <ul className="flex flex-col gap-3">
              {profile.plan.scopes.map((scope, index) => (
                <li key={index}>
                  <p className="flex items-center gap-2 text-body-medium">
                    {profile.plan.layout === "bots" && (
                      <BotAvatar avatar={scope.avatar} />
                    )}
                    {scope.label}
                  </p>
                  <p className="whitespace-pre-wrap text-text-secondary">
                    {scope.purpose}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-text-secondary">
              This creates the conversations shown above. Your original chat
              stays available.
            </p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void controller
                  .confirm(profile)
                  .then((ok) => {
                    if (
                      ok &&
                      active.current &&
                      controller.profile?.profile.id === profile.id &&
                      controller.profile.profile.kind === "ready"
                    )
                      onOpen();
                  })
                  .finally(() => setPending(false));
              }}
            >
              Use this setup
            </Button>
          </section>
        )}
        {onSetup && (
          <Button
            variant="secondary"
            onClick={() => {
              active.current = false;
              controller.original();
              onSetup();
            }}
          >
            Set up in chat
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setCreating(!creating)}
        >
          {creating ? "Cancel manual setup" : "Set up manually"}
        </Button>
        {creating && (
          <ProposalForm
            disabled={pending}
            onPropose={(plan) => {
              setPending(true);
              void controller
                .propose(plan)
                .then((ok) => {
                  if (ok && active.current) setCreating(false);
                })
                .finally(() => setPending(false));
            }}
          />
        )}
      </section>
    </main>
  );
}
function ProposalForm({
  disabled,
  onPropose,
}: {
  disabled: boolean;
  onPropose: (plan: ExperiencePlan) => void;
}) {
  const [layout, setLayout] = useState<ExperienceLayout>("single");
  const [title, setTitle] = useState("");
  const [assistantName, setAssistantName] = useState("Gaia");
  const [purpose, setPurpose] = useState("");
  const [scopes, setScopes] = useState([{ label: "Main", purpose: "" }]);
  const [error, setError] = useState("");
  const field =
    "w-full rounded-lg bg-background-tertiary-default p-3 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring";
  return (
    <form
      className="flex w-full flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = ExperiencePlan.safeParse({
          layout,
          title,
          assistantName,
          purpose,
          scopes: scopes.map((scope, index) => ({
            ...scope,
            purpose: scope.purpose || purpose,
            ...(layout === "bots"
              ? { avatar: `bot-${String(index % 8).padStart(2, "0")}` }
              : {}),
          })),
        });
        if (!parsed.success) {
          setError(
            "Give the profile and every conversation a name and purpose.",
          );
          return;
        }
        setError("");
        onPropose(parsed.data);
      }}
    >
      <label>
        Pattern
        <select
          className={field}
          value={layout}
          disabled={disabled}
          onChange={(event) => {
            const value = ExperiencePlan.shape.layout.parse(event.target.value);
            setLayout(value);
            setScopes(
              value === "bots"
                ? [
                    {
                      label: "Home",
                      purpose: "Coordinate selected work across Bots.",
                    },
                  ]
                : [
                    {
                      label: value === "sessions" ? "First session" : "Main",
                      purpose: "",
                    },
                  ],
            );
          }}
        >
          {Object.entries(layouts).map(([id, value]) => (
            <option key={id} value={id}>
              {value.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-text-secondary">{layouts[layout].description}</p>
      <label>
        Profile name
        <input
          required
          className={field}
          value={title}
          maxLength={100}
          disabled={disabled}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Assistant name
        <input
          required
          className={field}
          value={assistantName}
          maxLength={100}
          disabled={disabled}
          onChange={(event) => setAssistantName(event.target.value)}
        />
      </label>
      <label>
        Purpose
        <textarea
          required
          className={field}
          value={purpose}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </label>
      {scopes.map((scope, index) => (
        <fieldset key={index} className="flex flex-col gap-2">
          <legend className="text-caption-1-medium">
            {layout === "bots"
              ? "Bot"
              : layout === "channels"
                ? "Channel"
                : "Conversation"}{" "}
            {index + 1}
          </legend>
          <label>
            Name
            <input
              required
              maxLength={100}
              className={field}
              disabled={disabled}
              value={scope.label}
              onChange={(event) =>
                setScopes(
                  scopes.map((value, i) =>
                    i === index
                      ? { ...value, label: event.target.value }
                      : value,
                  ),
                )
              }
            />
          </label>
          {layout !== "single" && (
            <label>
              Purpose, or use the profile purpose
              <textarea
                className={field}
                maxLength={4000}
                value={scope.purpose}
                disabled={disabled}
                onChange={(event) =>
                  setScopes(
                    scopes.map((value, i) =>
                      i === index
                        ? { ...value, purpose: event.target.value }
                        : value,
                    ),
                  )
                }
              />
            </label>
          )}
        </fieldset>
      ))}
      {layout !== "single" && scopes.length < 20 && (
        <Button
          variant="ghost"
          size="small"
          disabled={disabled}
          onClick={() => setScopes([...scopes, { label: "", purpose: "" }])}
        >
          Add{" "}
          {layout === "bots"
            ? "Bot"
            : layout === "channels"
              ? "channel"
              : "session"}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="secondary" disabled={disabled}>
        Review proposal
      </Button>
    </form>
  );
}
