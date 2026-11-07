import { useEffect, useState } from "react";
import { Action, Card, StatusPill } from "./ui";
import { changeImage, revertChange, type ManagedChange } from "../../packages/sdk/managed.ts";
import type { ChangeSource } from "../../packages/protocol/change-preview.ts";
import { watchManaged } from "./managed-history";
import { changesForReply } from "./change-card-model";
export { changesForReply } from "./change-card-model";

const outcomes: Record<ManagedChange["outcome"], string> = { staged: "Staged", queued: "Queued", checking: "Checking", accepted: "Applied", rejected: "Not applied", "rolled-back": "Restored", interrupted: "Interrupted" };

export function useManagedChanges(enabled: boolean, revision: string) {
  const [changes, setChanges] = useState<ManagedChange[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return watchManaged({ publish: view => setChanges(view?.changes ?? []), fail() {} });
  }, [enabled, revision]);
  return changes;
}

export function ChangeCard({ change, disabled = false, onRevert, imageUrl = changeImage }: { change: ManagedChange; disabled?: boolean; onRevert?: (id: string) => void; imageUrl?: typeof changeImage }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const issues = change.critique?.blocking ?? [];
  const shots = (change.previews?.shots ?? []).filter(shot => shot.theme === theme);
  const scenario = change.previews?.surfaces?.[0]?.name;
  const shown = [1000, 320].map(width => shots.find(shot => shot.width === width && shot.scenario === scenario) ?? shots.find(shot => shot.width === width && shot.scenario === "answer") ?? shots.find(shot => shot.width === width)).filter(shot => shot !== undefined);
  return <Card className="change-card flex min-w-0 flex-col gap-4 rounded-xl border border-separator-border p-4 wrap-anywhere" title={change.reason} pill={<StatusPill>{outcomes[change.outcome]}</StatusPill>} actions={change.outcome === "accepted" && onRevert ? <Action variant="secondary" className="secondary-action inline-flex min-h-9 items-center justify-center rounded-lg border border-separator-border px-3 py-2 text-body-medium" disabled={disabled} onClick={() => onRevert(change.id)}>Revert</Action> : undefined}>
    <div className="change-shots-heading"><span className="text-caption-1-regular">Before and after</span><Action variant="quiet" size="small" aria-pressed={theme === "dark"} onClick={() => setTheme(value => value === "light" ? "dark" : "light")}>{theme === "light" ? "View dark" : "View light"}</Action></div>
    <div className="change-shots">{shown.map(shot => <div className="change-shot-pair" key={shot.name}><p className="text-caption-1-regular">{shot.width === 320 ? "Narrow" : "Wide"}</p>{(["before", "after"] as const).map(side => <figure key={side}><figcaption className="text-caption-1-regular">{side === "before" ? "Before" : "After"}</figcaption>{failedImages.includes(shot[side]) ? <p>Preview image is unavailable.</p> : <a href={imageUrl(change.id, shot[side])} target="_blank" rel="noreferrer" aria-label={`Open ${side} ${shot.width} px ${theme} preview`}><img src={imageUrl(change.id, shot[side])} alt={`${side === "before" ? "Before" : "After"}, ${shot.width} px, ${theme}`} onError={() => setFailedImages(value => [...value, shot[side]])} /></a>}</figure>)}</div>)}</div>
    {!shown.length && <p>Preview images are unavailable.</p>}
    {issues.length > 0 && <><p>Review found issues</p><ul>{issues.map((issue, index) => <li key={index}>{issue.issue} <span className="text-caption-1-regular">{issue.shots.join(", ")}</span></li>)}</ul></>}
    <p>Advisory screenshot review. </p>
    <p>{change.critique?.summary ?? "No separate review was recorded."}</p>
    {Boolean(change.previews?.alsoChanged.length) && <p>Also changed: {change.previews?.alsoChanged.join(", ")}</p>}
    <details><summary>Diff and checks</summary><p>{change.detail}</p>{change.checks.length ? <ul>{change.checks.map((check, index) => <li key={index} className="whitespace-pre-wrap">{check}</li>)}</ul> : <p>No check receipts recorded.</p>}<pre>{change.diff}</pre></details>
  </Card>;
}

export function ReplyChanges({ changes, source, disabled }: { changes: ManagedChange[]; source: ChangeSource; disabled: boolean }) {
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [queued, setQueued] = useState<string>();
  useEffect(() => {
    if (!queued) return;
    return watchManaged({ waitingFor: queued, publish(view) { const result = view?.changes.find(change => change.id === queued); if (result && !["staged", "queued", "checking"].includes(result.outcome)) { setWaiting(false); setQueued(undefined); setError(result.outcome === "accepted" ? "" : result.detail); } }, fail(message) { setError(message); setWaiting(false); } });
  }, [queued]);
  return <>{changesForReply(changes, source).map(change => <ChangeCard key={change.id} change={change} disabled={disabled || waiting} onRevert={id => {
    setWaiting(true); setError("");
    void revertChange(id, new AbortController().signal).then(result => setQueued(result.id)).catch(cause => { setWaiting(false); setError(cause instanceof Error ? cause.message : "Revert could not be queued."); });
  }} />)}{error && <p role="alert">{error}</p>}</>;
}
