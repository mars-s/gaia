import { createContext, useContext, type ReactNode } from "react";

export type PreviewState = "empty" | "loading" | "error";
const PreviewContext = createContext<PreviewState | undefined>(undefined);

/** Forces surface states for trusted previews. @example <Preview state="error">{surface}</Preview> */
export function Preview({ state, children }: { state: PreviewState; children: ReactNode }) {
  return <PreviewContext value={state}>{children}</PreviewContext>;
}

/** Returns the forced preview state, or the surface’s real state. @example const state = usePreviewState(actual); */
export function usePreviewState<T>(actual: T): T | PreviewState {
  return useContext(PreviewContext) ?? actual;
}
