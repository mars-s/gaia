import type { ExperienceScope } from "../../packages/protocol/experiences";
export const sessionHues = ["sky", "rose", "sage", "amber", "lilac", "slate"] as const;
export function sessionTiles(scopes: ExperienceScope[]) {
  const seen = new Set<string>();
  return new Map([...scopes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((scope, index) => {
    const words = scope.label.trim().split(/\s+/);
    const first = Array.from(words[0] ?? "");
    const initial = first[0]?.toLocaleUpperCase() ?? "";
    const monogram = initial + (words.length > 1 ? Array.from(words[1])[0]?.toLocaleUpperCase() ?? "" : "");
    const text = seen.has(monogram) ? initial + (first[1]?.toLocaleLowerCase() ?? "") : monogram;
    seen.add(monogram);
    return [scope.id, { text, hue: sessionHues[index % sessionHues.length] }];
  }));
}
