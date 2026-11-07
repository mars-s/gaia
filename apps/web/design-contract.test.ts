import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import postcss, { type AnyNode as CssNode } from "postcss";
import { z } from "zod";
import { ProgressRow } from "./progress-row";
import { BotAvatar } from "./experiences/view";

const web = fileURLToPath(new URL(".", import.meta.url));
const tokenPaths = new Set(["styles/theme.css", "styles/globals.css", "styles/tokens.css"]);
const legacyButtons = new Map([
  ["components/base/buttons/button.tsx", 1],
  ["components/base/buttons/icon-button.tsx", 1],
  ["components/base/social-button/social-button.tsx", 1],
  ["components/base/dropdown/dropdown.tsx", 1],
]);
const maximumSpacing = 232;
const maximumStyleBytes = 58667;
const maximumDuplicateSelectors = 70;
const colourLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(|\b(?:white|black|red|blue|green|yellow|pink|purple|orange|grey|gray|rebeccapurple)\b/i;
const spacingProperty = /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-|$)/;
const px = /-?\d*\.?\d+px\b/g;
const botHashes: Record<string, string> = {
  "bot-00.svg": "961a716a3b50a9afe7b65df28af4314737cb4533c22240d1a78b1836e555b185",
  "bot-01.svg": "f778ebe7eb3c28acbfeef0c84af0649177c8e5770c8436f94ec40fba222f2145",
  "bot-02.svg": "7650b12e712814f1adedeabe56e47221ce51173c09698db64deee3c7524dbc23",
  "bot-03.svg": "89859626f3a92dd675f27530f9f66b2883d44801be865fa74ab518b4b5847525",
  "bot-04.svg": "794023d6b63614f0e97fb58e41e63c740dec103fc75c6993e60d506dc8857b6f",
  "bot-05.svg": "c61accf72e0375d1164d8f546b7b0d9a8dda30618ce58a11629dd948d53d1ee9",
  "bot-06.svg": "80d973d4e1636e1c33b2bd18e80d6114f7fac2122536bc2f98052aeb42ba7b1e",
  "bot-07.svg": "842c90c41e87ae67dcfa469afa41979a3221e13ea3c3931224345d43ff2e1de3"
};
type Files = Map<string, string>;
function readFiles(directory = web, files: Files = new Map()): Files {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    if (entry.isDirectory()) readFiles(path, files);
    else if (/\.(?:css|tsx?|svg|json)$/.test(path) && !/\.test\.tsx?$/.test(path)) files.set(relative(web, path), readFileSync(path, "utf8"));
  }
  return files;
}
function duplicateSelectors(css: string) {
  const counts = new Map<string, number>();
  postcss.parse(css).walkRules(rule => {
    const scope: string[] = [];
    for (let parent: CssNode | undefined = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type === "atrule") scope.push(`${parent.name} ${parent.params}`);
      else if (parent.type === "rule") scope.push(parent.selector);
    }
    const key = `${scope.join("/")}|${rule.selector}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.values()].filter(count => count > 1).length;
}
function sourceRules(path: string, source: string) {
  const issues: string[] = [];
  const report = (rule: number, node: ts.Node, reason: string) => issues.push(`[${rule}] ${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${reason}`);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let buttons = 0;
  let spacing = 0;
  function walk(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === "button") {
      buttons++;
      if (!path.startsWith("ui/") && !legacyButtons.has(path)) report(4, node, "Use Action, IconButton or a kit menu item instead of a raw button.");
    }
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      if (/[\u2013\u2014]/.test(text)) report(7, node, "No en or em dashes in user strings.");
      if (/[A-Za-z]'[A-Za-z]/.test(text)) report(7, node, "Use curly apostrophes in copy.");
      if (/\bOops\b|coming soon/i.test(text) || /^(?:Thinking|Working|Running)(?:…|\.\.\.)?$/.test(text.trim())) report(7, node, "No invented features or generic progress phrases.");
      if (ts.isJsxText(node) && /\b(?:color|colors|favorite|favorites|organize|organized|center|canceled)\b/i.test(text)) report(7, node, "Use Australian spelling in JSX text.");
      const unreferenced = text.replace(/var\(--[\w-]+\)/g, "");
      const colourContext = ts.isPropertyAssignment(node.parent) && /^(?:color|background(?:Color)?|fill|stroke|borderColor|outlineColor)$/.test(node.parent.name.getText(file));
      const rawColour = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/i.test(unreferenced) || (colourContext && colourLiteral.test(unreferenced)) || /(?:text|bg|border|ring|fill|stroke)-\[(?:white|black|red|blue|green|yellow|pink|purple|orange|grey|gray|rebeccapurple)\]/i.test(text);
      if (path.startsWith("surfaces/") && /(?:p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|inset(?:-[xy])?|top|right|bottom|left)-\[[^\]]*\dpx[^\]]*\]/.test(text)) report(3, node, "Use the Tailwind spacing scale, not arbitrary px values.");
      if (path.endsWith(".tsx") && rawColour) report(2, node, "Colour literals belong in token files, including arbitrary Tailwind and inline style colours.");
      if (ts.isPropertyAssignment(node.parent)) {
        const property = node.parent.name.getText(file).replace(/["']/g, "").replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        if (spacingProperty.test(property)) {
          const count = (text.match(px) ?? []).length;
          spacing += count;
          if (path.startsWith("surfaces/") && count) report(3, node, "Use spacing tokens or the Tailwind scale in surfaces.");
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  const allowed = legacyButtons.get(path);
  if (allowed !== undefined && buttons > allowed) issues.push(`[4] ${path}: legacy button count grew beyond ${allowed}.`);
  if (path === "progress-row.tsx" && /setInterval|progress-elapsed|seconds elapsed|<time\b/.test(source)) issues.push(`[9] ${path}: progress must not contain a timer.`);
  return { issues, spacing };
}

type Colour = [number, number, number, number];
function colour(value: string, values: Map<string, string>, seen = new Set<string>()): Colour {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) {
    const key = reference[1];
    assert(!seen.has(key), `Cyclic colour token ${key}`);
    const next = values.get(key);
    assert(next, `Missing colour token ${key}`);
    return colour(next, values, new Set([...seen, key]));
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join("") : hex[1];
    const linear = (index: number) => { const channel = parseInt(digits.slice(index, index + 2), 16) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; };
    return [linear(0), linear(2), linear(4), 1];
  }
  const oklch = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+|none)\)$/.exec(value);
  if (oklch) {
    const L = Number(oklch[1]) / 100, C = Number(oklch[2]), h = (oklch[3] === "none" ? 0 : Number(oklch[3])) * Math.PI / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l = (L + .3963377774*a + .2158037573*b) ** 3, m = (L - .1055613458*a - .0638541728*b) ** 3, s = (L - .0894841775*a - 1.291485548*b) ** 3;
    const clip = (channel: number) => Math.max(0, Math.min(1, channel));
    return [clip(4.0767416621*l - 3.3077115913*m + .2309699292*s), clip(-1.2684380046*l + 2.6097574011*m - .3413193965*s), clip(-.0041960863*l - .7034186147*m + 1.707614701*s), 1];
  }
  throw new Error(`Unsupported colour token ${value}`);
}
function contrast(foreground: Colour, background: Colour) {
  const luminance = (rgb: Colour) => .2126*rgb[0] + .7152*rgb[1] + .0722*rgb[2];
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function dangerStyle(files: Files, path: string, selector: string, mode: string) {
  let fill = "var(--color-surface-hover)", underline = false, focus = false;
  postcss.parse(files.get(path) ?? "").walkRules(rule => {
    if (mode === "light" && rule.selector.includes(".dark")) return;
    if (rule.selector.includes(`${selector}:hover`)) rule.walkDecls(decl => {
      if (decl.prop === "background" || decl.prop === "background-color") fill = decl.value;
      if (decl.prop === "text-decoration" || decl.prop === "text-decoration-line") underline = decl.value.includes("underline");
    });
    if (rule.selector.includes(`${selector}:focus-visible`)) rule.walkDecls(decl => {
      if (decl.prop === "outline" || decl.prop === "box-shadow") focus = !/^(?:none|0(?:px)?)$/.test(decl.value) && decl.value.includes("var(--color-focus)");
    });
  });
  return { fill, underline, focus };
}
function contrastRules(files: Files) {
  const common = new Map<string, string>(), dark = new Map<string, string>();
  const base = readFileSync(fileURLToPath(import.meta.resolve("tailwindcss/theme.css")), "utf8");
  for (const css of [base, files.get("styles/theme.css"), files.get("styles/tokens.css")]) {
    assert(css, "Missing theme or tokens");
    postcss.parse(css).walkDecls(decl => {
      if (!decl.prop.startsWith("--")) return;
      let isDark = false;
      for (let parent: CssNode | undefined = decl.parent; parent; parent = parent.parent) if (parent.type === "rule" && parent.selector.includes(".dark")) isDark = true;
      (isDark ? dark : common).set(decl.prop, decl.value.trim());
    });
  }
  const issues: string[] = [];
  for (const mode of ["light", "dark"]) {
    const values = new Map([...common, ...(mode === "dark" ? dark : [])]);
    const surfaces = ["page", "raised", "sunken", "hover", "selected"].map(name => `--color-surface-${name}`);
    const pairs: [string, string, number][] = [];
    for (const surface of surfaces) {
      for (const ink of ["--color-ink", "--color-ink-2", "--color-ink-3"]) pairs.push([ink, surface, 4.5]);
      pairs.push(["--color-focus", surface, 3]);
    }
    // Accent labels use the strong accent fill; primary labels use the primary fill.
    pairs.push(["--color-accent-ink", "--color-accent-strong", 4.5], ["--color-primary-ink", "--color-primary-fill", 4.5]);
    for (const surface of ["--color-surface-page", "--color-surface-raised"]) pairs.push(["--color-danger", surface, 4.5]);
    // Links sit on the page and code/raised surfaces; accent pills have their own fill.
    for (const surface of ["--color-surface-page", "--color-surface-raised", "--color-surface-sunken"]) pairs.push(["--color-link", surface, 4.5], ["--color-link-hover", surface, 4.5]);
    pairs.push([mode === "dark" ? "--color-accent-strong" : "--color-primary-fill", "--color-accent-soft", 4.5]);
    for (const [path, selector] of [["style.css", ".settings-content .plan-disconnect.quiet-action"], ["ui/ui.css", ".ui-danger"]]) {
      const hover = dangerStyle(files, path, selector, mode);
      const fill = hover.fill === "transparent" ? values.get("--color-surface-page") : hover.fill;
      const ink = values.get("--color-danger");
      assert(fill && ink);
      const ratio = contrast(colour(ink, values), colour(fill, values));
      if (ratio < 4.5) issues.push(`[8] ${path}: ${mode} danger hover is ${ratio.toFixed(3)}:1, requires 4.5:1.`);
      if (!hover.underline || !hover.focus) issues.push(`[8] ${path}: danger actions need an underline hover cue and visible focus ring.`);
    }
    for (const [ink, surface, required] of pairs) {
      const a = values.get(ink), b = values.get(surface);
      assert(a && b, `Missing contrast pair ${ink} ${surface}`);
      const ratio = contrast(colour(a, values), colour(b, values));
      if (ratio < required) issues.push(`[8] styles/theme.css: ${mode} ${ink} on ${surface} is ${ratio.toFixed(3)}:1, requires ${required}:1.`);
    }
  }
  return issues;
}
function designRules(files: Files) {
  const issues: string[] = [];
  let spacing = 0;
  for (const [path, source] of files) {
    if (/\.tsx?$/.test(path)) {
      const scanned = sourceRules(path, source);
      issues.push(...scanned.issues);
      spacing += scanned.spacing;
    }
    if (!path.endsWith(".css")) continue;
    postcss.parse(source).walkDecls(decl => {
      if (!tokenPaths.has(path) && colourLiteral.test(decl.value.replace(/var\(--[\w-]+\)/g, ""))) issues.push(`[2] ${path}:${decl.source?.start?.line}: colour literals belong in token files.`);
      if (spacingProperty.test(decl.prop)) {
        const count = (decl.value.match(px) ?? []).length;
        spacing += count;
        if (path.startsWith("surfaces/") && count) issues.push(`[3] ${path}:${decl.source?.start?.line}: raw spacing px is forbidden in surfaces.`);
      }
    });
    if (path.startsWith("surfaces/") && duplicateSelectors(source)) issues.push(`[6] ${path}: duplicate selectors are forbidden in surfaces.`);
  }
  if (spacing > maximumSpacing) issues.push(`[3] apps/web: raw spacing grew to ${spacing}, maximum ${maximumSpacing}.`);
  const style = files.get("style.css") ?? "";
  if (Buffer.byteLength(style) > maximumStyleBytes) issues.push(`[6] style.css: byte size exceeds ${maximumStyleBytes}.`);
  if (duplicateSelectors(style) > maximumDuplicateSelectors) issues.push(`[6] style.css: duplicate selectors exceed ${maximumDuplicateSelectors}.`);
  issues.push(...contrastRules(files));
  const provenance = z.object({ assets: z.array(z.object({ file: z.string(), sha256: z.string() })) }).parse(JSON.parse(files.get("public/bots/provenance.json") ?? "null"));
  for (const [name, expected] of Object.entries(botHashes)) {
    const source = files.get(`public/bots/${name}`);
    if (!source || createHash("sha256").update(source).digest("hex") !== expected || provenance.assets.find(asset => asset.file === name)?.sha256 !== expected) issues.push(`[9] public/bots/${name}: fixed owner artwork hash changed.`);
  }
  return issues;
}
function progressRules(html: string, description?: string) {
  const text = html.replace(/<[^>]+>/g, "");
  assert.equal(text, `${description ?? ""}Stop`, "Progress must contain only actual activity wording and Stop");
  assert.match(html, /working-indicator/);
  assert.doesNotMatch(html, /elapsed|<time\b|\b\d+(?:s|m)\b|Thinking|Working|Running/);
}

test("protected design guardrails 2, 3, 4, 6, 7, 8 and 9 pass on product source", () => {
  assert.deepEqual(designRules(readFiles()), []);
});
test("each static guardrail rejects a planted bad candidate edit with its rule and path", async t => {
  const baseline = readFiles();
  const cases: [string, string, string, RegExp][] = [
    ["raw colour", "surfaces/planted.css", ".planted { color: #123456; }", /\[2\] surfaces\/planted.css/],
    ["inline colour", "surfaces/planted.tsx", 'export const Bad = () => <span style={{color: "red"}}>Bad</span>;', /\[2\] surfaces\/planted.tsx/],
    ["arbitrary colour", "surfaces/planted.tsx", 'export const Bad = () => <span className="text-[#123456]">Bad</span>;', /\[2\] surfaces\/planted.tsx/],
    ["raw spacing", "surfaces/planted.css", ".planted { padding: 7px; }", /\[3\] surfaces\/planted.css/],
    ["inline spacing", "surfaces/planted.tsx", 'export const Bad = () => <span style={{paddingInline: "7px"}}>Bad</span>;', /\[3\] surfaces\/planted.tsx/],
    ["arbitrary spacing", "surfaces/planted.tsx", 'export const Bad = () => <span className="p-[7px]">Bad</span>;', /\[3\] surfaces\/planted.tsx/],
    ["raw action", "surfaces/planted.tsx", 'export const Bad = () => <button>Bad</button>;', /\[4\] surfaces\/planted.tsx/],
    ["duplicate CSS", "surfaces/planted.css", ".planted { display: block; } .planted { display: flex; }", /\[6\] surfaces\/planted.css/],
    ["copy", "surfaces/planted.tsx", 'export const Bad = () => <span>Oops, coming soon</span>;', /\[7\] surfaces\/planted.tsx/],
    ["dash", "surfaces/planted.tsx", 'export const Bad = () => <span>One\u2014two</span>;', /\[7\] surfaces\/planted.tsx/],
    ["apostrophe", "surfaces/planted.tsx", 'export const Bad = () => <span>Don\u0027t</span>;', /\[7\] surfaces\/planted.tsx/],
    ["US copy", "surfaces/planted.tsx", 'export const Bad = () => <span>Favorite color</span>;', /\[7\] surfaces\/planted.tsx/],
    ["muted contrast", "styles/theme.css", (baseline.get("styles/theme.css") ?? "").replaceAll(/--color-ink-3: oklch\([^;]+;/g, "--color-ink-3: var(--color-neutral-500);"), /\[8\] styles\/theme.css/],
    ["primary label", "styles/theme.css", (baseline.get("styles/theme.css") ?? "").replace("--color-primary-ink: var(--color-white);", "--color-primary-ink: var(--color-primary-fill);"), /\[8\] styles\/theme.css/],
    ["accent ink", "styles/theme.css", (baseline.get("styles/theme.css") ?? "").replace("--color-accent-ink: var(--color-white);", "--color-accent-ink: var(--color-accent-strong);"), /\[8\] styles\/theme.css/],
    ["danger ink", "styles/theme.css", (baseline.get("styles/theme.css") ?? "").replace("--color-danger: var(--color-red-600);", "--color-danger: var(--color-neutral-300);"), /\[8\] styles\/theme.css/],
    ["generic progress", "surfaces/planted.tsx", 'export const Bad = () => <span>Thinking</span>;', /\[7\] surfaces\/planted.tsx/],
    ["dark focus", "styles/theme.css", (baseline.get("styles/theme.css") ?? "").replace("--color-focus: oklch(57.9% 0.223 3.958);", "--color-focus: var(--color-primary-fill);"), /\[8\] styles\/theme.css/],
    ["danger hover", "ui/ui.css", (baseline.get("ui/ui.css") ?? "").replace(".ui-danger:hover { background: var(--color-surface-page);", ".ui-danger:hover { background: var(--color-surface-hover);"), /\[8\] ui\/ui.css/],
    ["artwork", "public/bots/bot-00.svg", "<svg />", /\[9\] public\/bots\/bot-00.svg/],
    ["timer", "progress-row.tsx", (baseline.get("progress-row.tsx") ?? "") + '\nconst timerLabel = "seconds elapsed";', /\[9\] progress-row.tsx/],
  ];
  for (const [name, path, source, expected] of cases) {
    await t.test(name, () => {
      const files = new Map(baseline);
      files.set(path, source);
      assert.match(designRules(files).join("\n"), expected, name);
    });
  }
  const alternate = new Map(baseline);
  alternate.set("ui/ui.css", (baseline.get("ui/ui.css") ?? "").replace(".ui-danger:hover { background: var(--color-surface-page);", ".ui-danger:hover { background: var(--color-surface-raised);"));
  assert.deepEqual(designRules(alternate), [], "An equally readable raised fill must remain editable");
  const duplicates = new Map(baseline);
  duplicates.set("style.css", (baseline.get("style.css") ?? "") + ".planted { display: block; } .planted { display: flex; }");
  assert.match(designRules(duplicates).join("\n"), /\[6\] style.css: duplicate selectors/);
  const rewrittenProvenance = new Map(baseline);
  rewrittenProvenance.set("public/bots/bot-00.svg", "<svg />");
  rewrittenProvenance.set("public/bots/provenance.json", (baseline.get("public/bots/provenance.json") ?? "").replace(botHashes["bot-00.svg"], createHash("sha256").update("<svg />").digest("hex")));
  assert.match(designRules(rewrittenProvenance).join("\n"), /\[9\] public\/bots\/bot-00.svg/);
  const larger = new Map(baseline);
  larger.set("style.css", (baseline.get("style.css") ?? "") + " ".repeat(maximumStyleBytes));
  assert.match(designRules(larger).join("\n"), /\[6\] style.css: byte size/);
  const moreSpacing = new Map(baseline);
  moreSpacing.set("legacy-spacing.css", ".legacy { padding: 1px; }");
  assert.match(designRules(moreSpacing).join("\n"), /\[3\] apps\/web: raw spacing grew/);
});
test("fixed Bot identities render only the eight approved robots, including unknown avatar values", () => {
  for (const avatar of ["bot-00", "bot-01", "bot-02", "bot-03", "bot-04", "bot-05", "bot-06", "bot-07", "other", "../outside", "https://example.invalid/avatar.svg"]) {
    const html = renderToStaticMarkup(createElement(BotAvatar, { avatar }));
    assert.match(html, /src="\/bots\/bot-0[0-7]\.svg"/);
    assert.equal((html.match(/<img /g) ?? []).length, 1);
  }
});
test("progress has no timer or invented wording before activity and preserves agent wording afterwards", t => {
  for (const seconds of [0, 1, 65, 3600]) {
    for (const description of [undefined, "Checking the calendar"]) {
      let reads = 0;
      t.mock.method(Date, "now", () => Date.parse("2026-11-05T00:00:00Z") + (reads++ ? seconds * 1000 : 0));
      const html = renderToStaticMarkup(createElement(ProgressRow, { active: true, description, children: createElement("button", null, "Stop") }));
      progressRules(html, description);
      assert.throws(() => progressRules(html + "<time>1s</time>", description));
      assert.throws(() => progressRules(html + "<span>Thinking</span>", description));
    }
  }
});
