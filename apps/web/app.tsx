import { EmptyChat } from "./empty-chat";
import { OfflineNotice } from "./progress-row";
import { ChatSwitcher } from "./chat-switcher";
import { createMainRestore, createNavigationGuard } from "./main-navigation";
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
import { ProfileExperience, SetupSettings } from "./experiences";
import { createExperienceController } from "./experiences/controller";
import {
  ExperienceProposalNotice,
  proposalsAfterAnswer,
  interviewOfferAllowed,
} from "./experiences/proposal";

export function App() {
  const [experiences] = useState(() => createExperienceController());
  useSyncExternalStore(experiences.subscribe, experiences.version);
  const [restoreMain] = useState(createMainRestore);
  const [experienceView, updateExperienceView] = useState<"original" | "chat">(
    "original",
  );
  const [legacyStore] = useState(() => createDraftStore(() => sessionStorage));
  const [controller] = useState(() =>
    createConversationController({
      legacy: legacyStore.read(),
      migrated: () => {
        legacyStore.save("");
      },
    }),
  );
  const [navigation] = useState(() =>
    createNavigationGuard(() => {
      const selected = controller.selected;
      const draft = controller.session(selected).draft.read();
      return JSON.stringify({
        selected,
        draft: draft.kind === "ready" ? draft.draft : draft,
        safeMode: controller.safeMode,
      });
    }),
  );
  function setExperienceView(value: "original" | "chat") {
    navigation.moved();
    updateExperienceView(value);
  }
  function setAccountOpen(value: boolean) {
    navigation.moved();
    updateAccountOpen(value);
  }
  const draftReady =
    controller.session(controller.selected).draft.read().kind === "ready";
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
  const [accountOpen, updateAccountOpen] = useState(false);
  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") updateAccountOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [accountOpen]);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [observeRelease] = useState(() =>
    createReleaseObserver(
      () => controller.prepareReload() && experiences.prepareReload(),
      () => window.location.reload(),
      loadedRelease(import.meta.url),
    ),
  );
  const [reviewAnswer, setReviewAnswer] = useState<string>();
  useEffect(() => {
    if (accountOpen || !reviewAnswer) return;
    const card = [...document.querySelectorAll(".setup-card")].find(
      (card) => card.getAttribute("data-setup-answer") === reviewAnswer,
    );
    if (card) {
      card.scrollIntoView({ block: "center" });
      setReviewAnswer(undefined);
    }
  }, [accountOpen, reviewAnswer, experienceView]);
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
    experiences.resume();
    const close = subscribe(controller.receiveHome, controller.setOffline);
    return () => {
      close();
      controller.pause();
      experiences.pause();
    };
  }, [controller, experiences]);
  useEffect(() => {
    if (!connected || controller.safeMode) experiences.pause();
    else experiences.resume();
  }, [connected, state?.runtime?.mode, controller, experiences]);
  useEffect(() => {
    if (
      !connected ||
      controller.safeMode ||
      experienceView !== "original" ||
      accountOpen ||
      !draftReady
    )
      return;
    return restoreMain(
      experiences.restoreSelection,
      navigation.capture(),
      () => {
        navigation.moved();
        updateExperienceView("chat");
      },
    );
  }, [
    connected,
    state?.runtime?.mode,
    experienceView,
    accountOpen,
    draftReady,
    controller,
    experiences,
    navigation,
    restoreMain,
  ]);
  useEffect(() => {
    if (
      connected &&
      !controller.safeMode &&
      state?.thread.run.kind !== "running"
    )
      void experiences.refresh();
  }, [
    connected,
    state?.thread.run.kind,
    state?.runtime?.mode,
    controller,
    experiences,
  ]);
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
  useEffect(() => {
    if (
      connected &&
      draftReady &&
      !accountOpen &&
      experienceView === "original" &&
      active?.thread.messages.length === 0
    )
      document
        .querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Message Gaia"]',
        )
        ?.focus({ preventScroll: true });
  }, [
    connected,
    draftReady,
    accountOpen,
    experienceView,
    active?.thread.messages.length,
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
  const setupCards = (answerId?: string) => {
    const proposals = proposalsAfterAnswer(
      experiences.profiles,
      answerId,
      experiences.createdSetups,
    );
    return (
      <ExperienceProposalNotice
        proposals={proposals}
        disabled={offline}
        errors={experiences.proposalErrors}
        pending={experiences.proposalPending}
        onUse={(p) => {
          const canNavigate = navigation.capture();
          void experiences.useSetup(p, canNavigate).then((opened) => {
            if (opened && canNavigate()) setExperienceView("chat");
          });
        }}
        onDismiss={(p) => {
          void experiences.dismiss(p);
        }}
        onReview={(id) => {
          navigation.moved();
          const canNavigate = navigation.capture();
          void experiences
            .selectProfile(id, undefined, canNavigate)
            .then((opened) => {
              if (opened && canNavigate()) setExperienceView("chat");
            });
        }}
      />
    );
  };
  const setupSwitcher = (
    <ChatSwitcher
      onManage={() => {
        setAccountOpen(true);
        requestAnimationFrame(() =>
          document.querySelector(".setup-settings")?.scrollIntoView(),
        );
      }}
      profiles={experiences.profiles}
      error={experiences.error}
      currentId={
        experienceView === "chat"
          ? (experiences.profile?.profile.id ?? null)
          : null
      }
      mainId={experiences.mainId}
      onSelect={(id) => {
        if (id === null) {
          experiences.original();
          setExperienceView("original");
          return;
        }
        navigation.moved();
        const canNavigate = navigation.capture();
        void experiences
          .selectProfile(id, undefined, canNavigate)
          .then((opened) => {
            if (opened && canNavigate()) setExperienceView("chat");
          });
      }}
    />
  );
  const accountControl = (
    <IconButton
      className="app-control border-transparent bg-transparent shadow-none"
      icon={accountOpen ? RiCloseLine : RiSettings3Line}
      aria-label={accountOpen ? "Close settings" : "Account settings"}
      aria-expanded={accountOpen}
      aria-controls="account-settings"
      onClick={() => setAccountOpen(!accountOpen)}
    />
  );
  const setupShell =
    connected &&
    !accountOpen &&
    experienceView === "chat" &&
    !controller.safeMode;
  return (
    <div className="app-shell flex h-dvh flex-col bg-background-full text-body-regular text-text-primary">
      {!setupShell && (
        <header
          className={`app-bar flex shrink-0 items-center${accountOpen ? " settings-bar" : ""}`}
        >
          <div className="app-bar-column reading-column">
            {accountOpen ? (
              <span className="settings-title">Settings</span>
            ) : connected && !controller.safeMode ? (
              setupSwitcher
            ) : (
              <span className="select-none text-body-medium">
                {connected ? "Original chat" : "Gaia"}
              </span>
            )}
            {connected && accountControl}
          </div>
        </header>
      )}

      {accountOpen && connected ? (
        <main
          id="account-settings"
          className="settings-page min-h-0 flex-1 overflow-y-auto"
        >
          <div className="reading-column">
            <section className="settings-content" aria-label="Settings">
              <section
                className="settings-section"
                aria-labelledby="plan-title"
              >
                <h2 id="plan-title">Plan</h2>
                <div className="settings-plan-row">
                  <div className="plan-status">
                    <span>ChatGPT</span>
                    <span className="text-text-secondary">Connected</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={pending || running || offline}
                    onClick={() =>
                      void act("auth/connect").then((ok) => {
                        if (ok) setAccountOpen(false);
                      })
                    }
                  >
                    Reconnect
                  </Button>
                </div>
              </section>
              <section
                className="settings-section"
                aria-labelledby="appearance-title"
              >
                <h2 id="appearance-title">Appearance</h2>
                <div className="w-60 max-w-full">
                  <AppearancePicker />
                </div>
              </section>
              {!controller.safeMode && (
                <SetupSettings
                  controller={experiences}
                  onOpen={() => {
                    setExperienceView("chat");
                    setAccountOpen(false);
                  }}
                  onBack={() => {
                    setExperienceView("original");
                    setAccountOpen(false);
                  }}
                  onReviewConversation={(proposal) => {
                    experiences.original();
                    controller.select(homeScope);
                    setExperienceView("original");
                    setAccountOpen(false);
                    followReply.current = false;
                    setReviewAnswer(proposal.proposal?.answerMessageId);
                  }}
                />
              )}
              <section
                className="settings-section"
                aria-labelledby="about-title"
              >
                <h2 id="about-title">About you</h2>
                {profilePanel(true)}
              </section>
              <ManagedSettings runtime={state?.runtime} />
              {error && (
                <p role="alert" className="text-text-error-primary">
                  {error}
                </p>
              )}
            </section>
          </div>
        </main>
      ) : !state || !connected ? (
        <main className="welcome-page grid min-h-0 flex-1 place-items-center overflow-y-auto px-4">
          <section
            className="welcome-composition"
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
                <div className="welcome-intro">
                  <span className="gaia-mark" aria-hidden="true" />
                  <h1 id="welcome-title" className="text-hero">
                    Finish signing in
                  </h1>
                  <p className="text-text-secondary">
                    Sign in to ChatGPT in your browser, then come back here.
                  </p>
                </div>
                <Button
                  className="welcome-button"
                  variant="secondary"
                  disabled={!connection.url}
                  onClick={() => void openBrowser()}
                >
                  Open browser again
                </Button>
                <p className="welcome-caption">
                  Sign in with your ChatGPT plan. No API key needed.
                </p>
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
                <div className="welcome-intro">
                  <span className="gaia-mark" aria-hidden="true" />
                  <h1 id="welcome-title" className="text-hero">
                    Welcome to Gaia
                  </h1>
                  <p className="text-text-secondary">
                    Gaia is an assistant that runs on your own machine. Your
                    conversations and memory stay here.
                  </p>
                </div>
                <SocialButton
                  className="welcome-button"
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
                <p className="welcome-caption">
                  {connection?.kind === "disconnected" && connection.message
                    ? connection.message
                    : "Sign in with your ChatGPT plan. No API key needed."}
                </p>
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
      ) : experienceView !== "original" && !controller.safeMode ? (
        <ProfileExperience
          controller={experiences}
          onSettings={() => setAccountOpen(true)}
          switcher={setupSwitcher}
          accountControl={accountControl}
        />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!controller.safeMode && (
            <WorkspaceNavigation
              state={controller.workspace.state}
              selected={scope}
              onSelect={(next) => {
                navigation.moved();
                controller.select(next);
              }}
            />
          )}
          <div
            className="conversation-scroll min-h-0 flex-1 overflow-y-auto"
            ref={transcript}
            onScroll={() => {
              const el = transcript.current;
              if (el) el.dataset.scrolled = String(el.scrollTop > 0);
              if (el)
                followReply.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 96;
            }}
          >
            <section
              className="reading-column flex min-h-full flex-col"
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
                <EmptyChat />
              ) : (
                <Transcript
                  key={scopeKey(scope)}
                  thread={active.thread}
                  onSettings={() => setAccountOpen(true)}
                  hasSetupCard={(id) =>
                    scope.kind === "home" &&
                    !controller.safeMode &&
                    proposalsAfterAnswer(
                      experiences.profiles,
                      id,
                      experiences.createdSetups,
                    ).length > 0
                  }
                  onRetry={() => void controller.act(scope, "retry")}
                  retryDisabled={
                    pending ||
                    offline ||
                    running ||
                    Boolean(controller.busyScope()) ||
                    !controller.available(scope)
                  }
                  afterMessage={
                    scope.kind === "home" && !controller.safeMode
                      ? setupCards
                      : undefined
                  }
                />
              )}
              {scope.kind === "home" && (
                <>
                  {(!profile ||
                    profileError ||
                    profile.kind === "interview" ||
                    profile.kind === "proposed" ||
                    (profile.kind === "new" &&
                      interviewOfferAllowed(
                        experiences.profiles,
                        active?.thread.messages.findLast(
                          (m) => m.role === "assistant",
                        )?.id,
                      ) &&
                      active?.thread.run.kind === "idle" &&
                      active.thread.messages.some(
                        (message) =>
                          message.role === "assistant" && message.text.trim(),
                      ))) && <div className="interview-slot">{profilePanel()}</div>}
                  {!controller.safeMode && setupCards()}
                  {!controller.safeMode && (
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
                  )}
                </>
              )}
              {Boolean(active?.thread.messages.length) && (
                <div className="transcript-clearance" aria-hidden="true" />
              )}
              <div ref={bottom} />
            </section>
          </div>
          <div className="reading-column composer-column flex shrink-0 flex-col gap-3 pt-3">
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
            {offline && <OfflineNotice />}
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
