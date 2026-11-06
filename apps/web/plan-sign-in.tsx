import { RiClaudeFill } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { SocialButton } from "@/components/base/social-button/social-button";
import type {
  Connection,
  PlanProvider,
} from "../../packages/protocol/index.ts";

export function ClaudeSignIn({
  disabled,
  onConnect,
}: {
  disabled: boolean;
  onConnect(): void;
}) {
  return (
    <SocialButton
      className="welcome-button"
      brand="custom"
      config={{
        label: "Claude",
        icon: <RiClaudeFill className="size-full" aria-hidden />,
      }}
      appearance="white"
      fullWidth
      disabled={disabled}
      onClick={onConnect}
    >
      Continue with Claude
    </SocialButton>
  );
}
export function PlanAccounts({
  connection,
  disabled,
  onConnect,
}: {
  connection: Connection;
  disabled: boolean;
  onConnect(provider: PlanProvider): void;
}) {
  return (
    [
      { provider: "openai-codex", label: "ChatGPT" },
      { provider: "anthropic", label: "Claude" },
    ] as const
  ).map(({ provider, label }) => {
    const connected =
      connection.plans?.find((plan) => plan.provider === provider)?.connected ??
      (provider === "openai-codex" && connection.kind === "connected");
    return (
      <div className="settings-plan-row" key={provider}>
        <div className="plan-status">
          <span>{label} plan</span>
          <span className="text-text-secondary">
            {connected ? "· Connected" : "· Not connected"}
          </span>
        </div>
        <Button
          variant="secondary"
          size="small"
          disabled={disabled}
          onClick={() => onConnect(provider)}
        >
          {connected ? "Reconnect" : "Connect"}
        </Button>
      </div>
    );
  });
}
