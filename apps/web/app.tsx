import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RiCloseLine, RiOpenaiFill, RiSettings3Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Input } from "@/components/base/input/input";
import { SocialButton } from "@/components/base/social-button/social-button";
import { subscribe } from "../../packages/sdk/index.ts";
import {
  createProfileReader,
  interviewQuestionVisible,
  type OwnerState,
} from "../../packages/sdk/onboarding.ts";
import { ProfilePanel } from "./profile-panel";
import { AppearancePicker } from "./appearance";
import { ManagedSettings } from "./managed-settings";
import {
  createDraftStore,
  createReleaseObserver,
  loadedRelease,
} from "./renderer-release";
import { createAuthBrowserFlow, openAuthInBrowser } from "./browser-auth";
import { Transcript } from "./transcript";
import { Composer } from "./composer";
import { createConversationController } from "./conversation-controller";
import { homeScope, scopeKey } from "./workspace-controller";
import { WorkspaceNavigation, WorkspaceProposalPanel } from "./workspace-panel";

export function App() {
  const [legacyStore] = useState(() => createDraftStore(() => sessionStorage));
  const [controller] = useState(() =>
    createConversationController({
      legacy: legacyStore.read(),
      migrated: () => {
        legacyStore.save("");
      },
    }),
  );
  const version = useSyncExternalStore(
    controller.subscribe,
    controller.version,
  );
  const state = controller.home;
  const scope = controller.selected;
  const active = controller.view(scope);
  const error = controller.session(homeScope).error;
  const pending = Boolean(controller.pending || controller.selectionPending);
  const running = Boolean(controller.busyScope());
  const offline = controller.offline;
  const connection = state?.connection;
  const connected = connection?.kind === "connected";
  const [profile, setProfile] = useState<OwnerState>();
  const [profileError, setProfileError] = useState(false);
  const [profileReader] = useState(() =>
    createProfileReader(
      (value) => {
        setProfile(value);
        setProfileError(false);
      },
      () => setProfileError(true),
    ),
  );
  const [authReply, setAuthReply] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [observeRelease] = useState(() =>
    createReleaseObserver(
      controller.prepareReload,
      () => window.location.reload(),
      loadedRelease(import.meta.url),
    ),
  );
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const authFlow = useRef(createAuthBrowserFlow(openAuthInBrowser));
  const lastMessage = active?.thread.messages.at(-1);
  const proposalId =
    profile?.kind === "proposed" ? profile.proposalId : undefined;
  const workspaceProposal =
    controller.workspace.state?.kind === "proposed"
      ? controller.workspace.state.proposal.proposalId
      : undefined;
  useEffect(() => {
    controller.resume();
    const close = subscribe(controller.receiveHome, controller.setOffline);
    return () => {
      close();
      controller.pause();
    };
  }, [controller]);
  useEffect(() => {
    setUpdateWaiting(observeRelease(state?.runtime?.release));
  }, [version, state?.runtime?.release, observeRelease]);
  useEffect(() => {
    if (connected && state?.thread.run.kind !== "running")
      void profileReader.refresh();
    else profileReader.cancel();
    return profileReader.cancel;
  }, [connected, state?.thread.run.kind, profileReader]);
  useEffect(() => {
    if (!connection) return;
    if (connection.kind !== "connecting") setBrowserError("");
    void authFlow
      .current(connection)
      .catch((cause: unknown) =>
        setBrowserError(
          cause instanceof Error
            ? cause.message
            : "Open your browser to continue signing in.",
        ),
      );
  }, [connection]);
  useEffect(() => {
    followReply.current = true;
  }, [scope]);
  useEffect(() => {
    if (followReply.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [
    scope,
    lastMessage?.text,
    lastMessage?.id,
    profile?.kind,
    proposalId,
    workspaceProposal,
  ]);
  const act = controller.homeAction;
  async function profileAction(action: string) {
    profileReader.cancel();
    const input =
      action === "confirm" && profile?.kind === "proposed"
        ? { proposalId: profile.proposalId }
        : {};
    if (await act(`profile/${action}`, input)) {
      controller.select(homeScope);
      setAccountOpen(false);
    }
    await profileReader.refresh();
  }
  const profilePanel = (account = false) => (
    <ProfilePanel
      state={profile}
      failed={profileError}
      account={account}
      disabled={pending || running || offline || profileError}
      onAction={(action) => void profileAction(action)}
      onRetry={() => void profileReader.refresh()}
      showQuestion={
        profile?.kind === "interview" &&
        interviewQuestionVisible(profile, state?.thread.messages ?? [])
      }
      skipDisabled={
        pending ||
        offline ||
        profileError ||
        controller.busyScope()?.kind === "area"
      }
    />
  );
  async function openBrowser() {
    if (connection?.kind !== "connecting" || !connection.url) return;
    try {
      await openAuthInBrowser(connection.url);
      setBrowserError("");
    } catch (cause) {
      setBrowserError(
        cause instanceof Error
          ? cause.message
          : "Your browser could not open. Try again.",
      );
    }
  }
  return (
    <div className="app-shell flex h-dvh flex-col bg-background-full text-body-regular text-text-primary">
      <header className="app-bar flex shrink-0 items-center justify-between gap-4 px-4">
        <span className="select-none text-body-medium">Gaia</span>
        {connected && (
          <IconButton
            className="app-control border-transparent bg-transparent shadow-none"
            icon={accountOpen ? RiCloseLine : RiSettings3Line}
            aria-label={
              accountOpen ? "Close account settings" : "Account settings"
            }
            aria-expanded={accountOpen}
            aria-controls="account-settings"
            onClick={() => setAccountOpen(!accountOpen)}
          />
        )}
      </header>

      {accountOpen && connected ? (
        <main
          id="account-settings"
          className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6"
        >
          <section
            className="flex w-full max-w-xs flex-col items-start gap-6"
            aria-labelledby="account-title"
          >
            <div className="flex flex-col gap-2">
              <h1 id="account-title" className="text-title-3-semibold">
                Account
              </h1>
              <p className="text-text-secondary">ChatGPT is connected.</p>
            </div>
            <Button
              variant="secondary"
              disabled={pending || running || offline}
              onClick={() =>
                void act("auth/connect").then((ok) => {
                  if (ok) setAccountOpen(false);
                })
              }
            >
              Reconnect ChatGPT
            </Button>
            <AppearancePicker />
            {profilePanel(true)}
            <ManagedSettings runtime={state?.runtime} />
            {error && (
              <p role="alert" className="text-text-error-primary">
                {error}
              </p>
            )}
          </section>
        </main>
      ) : !state || !connected ? (
        <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 pb-12">
          <section
            className="flex w-full max-w-xs flex-col gap-6"
            aria-labelledby="welcome-title"
          >
            {!state ? (
              <p
                id="welcome-title"
                role="status"
                className="text-text-secondary"
              >
                {offline
                  ? "Gaia is unavailable. Reconnecting…"
                  : "Connecting to Gaia…"}
              </p>
            ) : connection?.kind === "connecting" ? (
              <>
                <div className="flex flex-col gap-2">
                  <h1 id="welcome-title" className="text-title-3-semibold">
                    Finish in your browser
                  </h1>
                  <p className="text-text-secondary">
                    Sign in to ChatGPT, then come back here.
                  </p>
                </div>
                <Button
                  className="self-start"
                  variant="secondary"
                  disabled={!connection.url}
                  onClick={() => void openBrowser()}
                >
                  Open browser
                </Button>
                {browserError && (
                  <p role="alert" className="text-text-error-primary">
                    {browserError}
                  </p>
                )}
                {connection.prompt && (
                  <details className="auth-help text-text-secondary">
                    <summary className="cursor-pointer rounded-md text-caption-1-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                      Having trouble?
                    </summary>
                    <form
                      className="mt-4 flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!authReply.trim() || pending || offline) return;
                        void act("auth/reply", {
                          value: authReply.trim(),
                        }).then((ok) => {
                          if (ok) setAuthReply("");
                        });
                      }}
                    >
                      <Input
                        label={connection.prompt}
                        autoComplete="off"
                        value={authReply}
                        onChange={setAuthReply}
                      />
                      <Button
                        variant="secondary"
                        type="submit"
                        disabled={!authReply.trim() || pending || offline}
                      >
                        Continue
                      </Button>
                    </form>
                  </details>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <h1 id="welcome-title" className="text-title-3-semibold">
                    Welcome to Gaia
                  </h1>
                  <p className="text-text-secondary">
                    {connection?.kind === "disconnected"
                      ? connection.message
                      : "Connect your ChatGPT account to get started."}
                  </p>
                </div>
                <SocialButton
                  brand="custom"
                  config={{
                    label: "ChatGPT",
                    icon: <RiOpenaiFill className="size-full" aria-hidden />,
                  }}
                  appearance="white"
                  fullWidth
                  disabled={pending || offline}
                  onClick={() => void act("auth/connect")}
                >
                  {pending ? "Connecting…" : "Continue with ChatGPT"}
                </SocialButton>
              </>
            )}
            {offline && state && (
              <p role="alert" className="text-text-error-primary">
                Connection lost. Reconnecting…
              </p>
            )}
            {error && (
              <p role="alert" className="text-text-error-primary">
                {error}
              </p>
            )}
          </section>
        </main>
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceNavigation
            state={controller.workspace.state}
            selected={scope}
            onSelect={controller.select}
          />
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            ref={transcript}
            onScroll={() => {
              const el = transcript.current;
              if (el)
                followReply.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 96;
            }}
          >
            <section
              className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-8"
              role="log"
              aria-label={
                scope.kind === "home"
                  ? "Home conversation"
                  : `${controller.workspace.areaList().find((area) => area.areaId === scope.areaId)?.label ?? "Area"} conversation`
              }
              aria-busy={active?.thread.run.kind === "running"}
            >
              {!active ? (
                <p role="status" className="py-8 text-text-secondary">
                  Loading conversation…
                </p>
              ) : active.thread.messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-12">
                  <h1 className="text-title-3-semibold">
                    What’s on your mind?
                  </h1>
                </div>
              ) : (
                <Transcript key={scopeKey(scope)} thread={active.thread} />
              )}
              {scope.kind === "home" && (
                <>
                  {(!profile ||
                    profileError ||
                    profile.kind === "interview" ||
                    profile.kind === "proposed" ||
                    (profile.kind === "new" &&
                      state.thread.messages.length === 0)) && (
                    <div className="py-4">{profilePanel()}</div>
                  )}
                  <WorkspaceProposalPanel
                    state={controller.workspace.state}
                    error={controller.workspace.error}
                    disabled={
                      pending ||
                      running ||
                      offline ||
                      !controller.workspace.ready()
                    }
                    onConfirm={(input) => void controller.confirm(input)}
                    onRetry={() => void controller.workspace.refresh()}
                  />
                </>
              )}
              <div ref={bottom} />
            </section>
          </div>
          <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pt-3 pb-5 sm:px-8 sm:pb-8">
            {state.runtime?.mode === "safe" && (
              <p
                role="status"
                className="text-caption-1-regular text-text-secondary"
              >
                Safe mode. Changes are disabled. You can still chat.
              </p>
            )}
            {updateWaiting && (
              <p
                role="status"
                className="text-caption-1-regular text-text-secondary"
              >
                An update is ready. Your draft must finish saving before Gaia
                reloads.
              </p>
            )}
            {offline && (
              <p role="alert" className="text-text-error-primary">
                Connection lost. Reconnecting… Your draft is here.
              </p>
            )}
            <Composer
              key={scopeKey(scope)}
              controller={controller}
              scope={scope}
              onHistory={state.runtime ? () => setAccountOpen(true) : undefined}
              onSend={() => {
                followReply.current = true;
              }}
            />
          </div>
        </main>
      )}
    </div>
  );
}
