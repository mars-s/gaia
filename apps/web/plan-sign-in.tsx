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
  onDisconnect,
}: {
  connection: Connection;
  disabled: boolean;
  onConnect(provider: PlanProvider): void;
  onDisconnect(provider: PlanProvider): void;
}) {
  return (
    [
      { provider: "openai-codex", label: "ChatGPT" },
      { provider: "anthropic", label: "Claude" },
    ] as const
  ).map(({ provider, label }) => {
    const plan = connection.plans?.find((plan) => plan.provider === provider);
    const connected =
      plan?.connected ??
      (provider === "openai-codex" && connection.kind === "connected");
    return (
      <div className="settings-plan-row" key={provider}>
        <div className="plan-status">
          <span>{label} plan</span>
          <span className="text-text-secondary">
            {"\u202f·\u202f"}{connected ? "Connected" : "Not connected"}
          </span>
          {plan?.error && (
            <span role="alert" className="text-text-error-primary">
              {plan.error}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="small"
            disabled={disabled}
            onClick={() => onConnect(provider)}
          >
            {connected ? "Reconnect" : "Connect"}
          </Button>
          {connected && (
            <Button
              variant="secondary"
              size="small"
              disabled={disabled}
              aria-label={`Disconnect ${label} plan`}
              onClick={() =>
                disconnectWithConfirmation(
                  provider,
                  (message) => window.confirm(message),
                  onDisconnect,
                )
              }
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>
    );
  });
}

export function disconnectWithConfirmation(
  provider: PlanProvider,
  confirm: (message: string) => boolean,
  disconnect: (provider: PlanProvider) => void,
) {
  const label = provider === "anthropic" ? "Claude" : "ChatGPT";
  if (
    confirm(
      `Disconnect your ${label} plan? Gaia will remove the saved sign-in for this plan. You can reconnect later.`,
    )
  )
    disconnect(provider);
}
