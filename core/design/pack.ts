import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { safeFile } from "../install.ts";

export async function designPack(active: string, core: string) {
  const index = ts.createSourceFile("index.ts", await readFile(await safeFile(active, "apps/web/ui/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const parts: string[] = [];
  for (const declaration of index.statements) {
    if (!ts.isExportDeclaration(declaration) || declaration.isTypeOnly || !declaration.exportClause || !ts.isNamedExports(declaration.exportClause) || !declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const module = declaration.moduleSpecifier.text;
    if (!/^\.\/[a-zA-Z0-9_/-]+$/.test(module)) throw new Error("Invalid UI kit export path");
    const path = `apps/web/ui/${module.slice(2)}.tsx`;
    const source = ts.createSourceFile(path, await readFile(await safeFile(active, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const part of declaration.exportClause.elements) {
      if (part.isTypeOnly) continue;
      const name = (part.propertyName ?? part.name).text;
      const definition = source.statements.find(node => (ts.isFunctionDeclaration(node) && node.name?.text === name) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === name)));
      const doc = definition?.getFullText(source).match(/\/\*\*([\s\S]*?)\*\//)?.[1].replace(/\s*\*\s?/g, " ").trim();
      if (!doc) throw new Error(`UI kit export needs a description and @example: ${name}`);
      if (!doc.includes("@example")) throw new Error(`UI kit export needs @example: ${name}`);
      parts.push(`${part.name.text}: ${doc}`);
    }
  }
  return [await readFile(join(core, "core/design/brief.md"), "utf8"), `Parts in the active release:\n${parts.join("\n")}`, "Read these exemplars before writing: apps/web/experiences/index.tsx (Settings Setups), apps/web/proposal-card.tsx.", await readFile(join(core, "core/design/rubric-compact.md"), "utf8"), "New UI lives in apps/web/surfaces/<name>/ with its own .tsx and .css. Never append a new surface to style.css."].join("\n\n");
}

export class DesignTurns {
  private seen = new Map<string, string>();
  first(conversation: string, turn: string) {
    if (this.seen.get(conversation) === turn) return false;
    this.seen.set(conversation, turn);
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value ?? "");
    return true;
  }
  forget(conversation: string) { this.seen.delete(conversation); }
}
