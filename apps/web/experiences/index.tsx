import { SettingsHeading } from "../settings-index";
import { StatusPill } from "../status-pill";
import { Menu } from "@base-ui/react/menu";
import { RiArrowDownSLine, RiCheckLine, RiAddLine } from "@remixicon/react";
import { SetupGlyph } from "../setup-glyph";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "../components/base/buttons/button";
import {
  ExperiencePlan,
  type ExperienceLayout,
  type Experience,
  type ExperienceId,
} from "../../../packages/protocol/experiences.ts";
import type { ExperienceController } from "./controller";
import { ExperienceConversation } from "./view";
import { ExperienceProposalNotice } from "./proposal";
import { Input } from "../components/base/input/input";
import { Textarea } from "../components/base/textarea/textarea";
import { Select, SelectItem } from "../components/base/select/select";

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
      "Separate histories and model settings. New remembered facts are shared across sessions.",
  },
};
export function setupSubtitle(layout: ExperienceLayout, n: number) {
  if (layout === "single") return "One conversation";
  if (layout === "bots") return n === 1 ? "1 Bot with its own memory" : `${n} Bots with separate memory`;
  if (layout === "channels") return `${n} ${n === 1 ? "channel" : "channels"} with shared memory`;
  return n === 1 ? "1 session with its own history" : `${n} sessions with separate histories`;
}
export function ProfileExperience({
  controller,
  switcher,
  accountControl,
  onSettings,
  onOriginal,
}: {
  controller: ExperienceController;
  switcher?: ReactNode;
  accountControl?: ReactNode;
  onSettings?: () => void;
  onOriginal?: () => void;
}) {
  useSyncExternalStore(
    controller.subscribe,
    controller.version,
    controller.version,
  );
  return (
    <ExperienceConversation
      controller={controller}
      switcher={switcher}
      accountControl={accountControl}
      onSettings={onSettings}
      onOriginal={onOriginal}
    />
  );
}

export function SetupSettings({
  controller,
  onOpen,
  onBack,
  onReviewConversation,
}: {
  controller: ExperienceController;
  onOpen: () => void;
  onBack: () => void;
  onReviewConversation: (proposal: Experience) => void;
}) {
  useSyncExternalStore(
    controller.subscribe,
    controller.version,
    controller.version,
  );
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState<ExperienceId>();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void controller.refresh();
    return () => {
      active.current = false;
    };
  }, [controller]);
  const mainTrigger = useRef<HTMLButtonElement>(null);
  const [makingMain, setMakingMain] = useState(false);
  const mainName = controller.profiles.find(item => item.id === controller.mainId)?.plan.title ?? "Original chat";
  const review = controller.profiles.find((item) => item.id === reviewing);
  return (
    <section
      className="setup-settings settings-section"
      aria-labelledby="setups-title"
    >
      <SettingsHeading id="setups-title">Setups</SettingsHeading>
      <div className="main-chat-setting">
        <div><p className="main-chat-label">Main chat</p><p className="main-chat-helper">Opens when Gaia starts.</p></div>
        <Menu.Root>
          <Menu.Trigger ref={mainTrigger} disabled={makingMain} aria-label={`Main chat: ${mainName}`} render={<Button variant="secondary" size="small" />}>
            <span className="truncate">{mainName}</span><RiArrowDownSLine className="size-4 shrink-0" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal><Menu.Positioner sideOffset={4} align="end" className="z-50"><Menu.Popup className="chat-switcher-menu" aria-label="Main chat">
            <Menu.RadioGroup value={controller.mainId ?? "original"}>
              {[{ id: null, name: "Original chat" }, ...controller.profiles.filter(item => item.kind === "ready").map(item => ({ id: item.id, name: item.plan.title }))].map(item => (
                <Menu.RadioItem key={item.id ?? "original"} value={item.id ?? "original"} className="chat-switcher-row" onClick={() => {
                  setMakingMain(true);
                  void controller.makeMain(item.id).finally(() => {
                    setMakingMain(false);
                    requestAnimationFrame(() => mainTrigger.current?.focus());
                  });
                }}>
                  <span className="min-w-0 flex-1">{item.name}</span><Menu.RadioItemIndicator><RiCheckLine className="size-4" aria-hidden /></Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup></Menu.Positioner></Menu.Portal>
        </Menu.Root>
      </div>
      <p className="your-setups-label">Your setups</p>
      {controller.error && (
        <p role="alert" className="text-text-error-primary">
          {controller.error}{" "}
          <button
            className="quiet-action quiet-link"
            onClick={() => void controller.refresh()}
          >
            Retry
          </button>
        </p>
      )}
      <ul className="flex w-full min-w-0 flex-col divide-y divide-separator-border">
        <li className="setup-list-row" aria-current={!controller.profile ? "page" : undefined}>
          <span className="avatar-tile"><SetupGlyph layout="single" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-body-medium setup-name">Original chat{controller.mainId === null && <StatusPill tone="accent">Main chat</StatusPill>}</p>{" "}
            <p className="text-caption-1-regular text-text-secondary">
              One conversation
            </p>
          </div>
          <div className="setup-row-meta">
          
          <div className="setup-row-actions">

            {(
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  controller.original();
                  onBack();
                }}
              >
                Open
              </Button>
            )}

          </div>
          </div>
        </li>
        {controller.profiles.map((item) => (
          <li key={item.id} className="setup-list-row" aria-current={controller.profile?.profile.id === item.id ? "page" : undefined}>
            <span className="avatar-tile"><SetupGlyph layout={item.plan.layout} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-body-medium wrap-anywhere setup-name">
                {item.plan.title}
                {controller.mainId === item.id && <StatusPill tone="accent">Main chat</StatusPill>}
              </p>{" "}
              <p className="text-caption-1-regular text-text-secondary">
                {setupSubtitle(item.plan.layout, item.plan.scopes.length)}
              </p>
            </div>
            <div className="setup-row-meta">
            {item.proposal?.dismissedAt || item.proposal?.supersededBy ? <StatusPill>Hidden</StatusPill> : item.kind === "proposed" ? <StatusPill>Proposed</StatusPill> : <span />}
            <div className="setup-row-actions">

              {(
                <Button
                  variant="secondary"
                  size="small"
                  disabled={pending}
                  onClick={() => {
                    if (item.kind === "proposed") {
                      if (
                        item.proposal?.source.kind === "conversation" &&
                        item.proposal.answerMessageId &&
                        !item.proposal.dismissedAt
                      ) {
                        onReviewConversation(item);
                        return;
                      }
                      setCreating(false);
                      setReviewing(item.id);
                      return;
                    }
                    void controller.selectProfile(item.id).then((ok) => {
                      if (ok && active.current) onOpen();
                    });
                  }}
                >
                  Open
                </Button>
              )}

            </div>
            </div>
          </li>
        ))}
      </ul>
      {controller.loading && (
        <p role="status" className="text-text-secondary">
          Loading setup…
        </p>
      )}
      {review && !creating && (
        <ExperienceProposalNotice
          proposals={[
            {
              ...review,
              proposal: review.proposal
                ? { ...review.proposal, dismissedAt: undefined }
                : undefined,
            },
          ]}
          disabled={pending}
          errors={controller.proposalErrors}
          pending={controller.proposalPending}
          onUse={(proposal) => {
            void controller
              .useSetup(proposal, () => active.current)
              .then((ok) => {
                if (ok && active.current) onOpen();
              });
          }}
          onDismiss={(proposal) => {
            void controller.dismiss(proposal).then(() => {
              if (active.current) setReviewing(undefined);
            });
          }}
          onReview={() => {
            void controller.selectProfile(review.id).then((ok) => {
              if (ok && active.current) onOpen();
            });
          }}
        />
      )}
      <button className="quiet-action setup-create" disabled={pending} onClick={() => setCreating(!creating)}>
        <RiAddLine aria-hidden="true" size={16} />
        {creating ? "Cancel" : "Create a setup manually"}
      </button>
      {creating && (
        <ProposalForm
          disabled={pending}
          onPropose={(plan) => {
            setPending(true);
            void controller
              .propose(plan)
              .then((ok) => {
                if (ok && active.current) {
                  setCreating(false);
                  setReviewing(controller.profile?.profile.id);
                }
              })
              .finally(() => setPending(false));
          }}
        />
      )}
    </section>
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
          setError("Give the setup and every conversation a name and purpose.");
          return;
        }
        setError("");
        onPropose(parsed.data);
      }}
    >
      <Select
        label="Pattern"
        selectedKey={layout}
        isDisabled={disabled}
        onSelectionChange={(key) => {
          const value = ExperiencePlan.shape.layout.parse(key);
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
          <SelectItem key={id} id={id} textValue={value.label}>
            {value.label}
          </SelectItem>
        ))}
      </Select>
      <p className="text-text-secondary">{layouts[layout].description}</p>
      <Input
        label="Setup name"
        isRequired
        value={title}
        maxLength={100}
        isDisabled={disabled}
        onChange={(value) => setTitle(value)}
      />
      <Input
        label="Assistant name"
        isRequired
        value={assistantName}
        maxLength={100}
        isDisabled={disabled}
        onChange={(value) => setAssistantName(value)}
      />
      <Textarea
        label="Purpose"
        isRequired
        value={purpose}
        maxLength={4000}
        isDisabled={disabled}
        onChange={(value) => setPurpose(value)}
      />
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
          <Input
            label="Name"
            isRequired
            maxLength={100}
            isDisabled={disabled}
            value={scope.label}
            onChange={(next) =>
              setScopes(
                scopes.map((value, i) =>
                  i === index ? { ...value, label: next } : value,
                ),
              )
            }
          />
          {layout !== "single" && (
            <Textarea
              label="Purpose, or use the setup purpose"
              maxLength={4000}
              value={scope.purpose}
              isDisabled={disabled}
              onChange={(next) =>
                setScopes(
                  scopes.map((value, i) =>
                    i === index ? { ...value, purpose: next } : value,
                  ),
                )
              }
            />
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
