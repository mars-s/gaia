import { resolve } from "node:path";
import { defineConfig } from "vite";
import ts from "typescript";
export default defineConfig({
  base: "./", root: resolve("apps/web"), resolve: { alias: { "@": resolve("apps/web") } },
  plugins: [{ name: "trusted-preview-state", enforce: "pre", transform(code, id) {
    const main = id === resolve("apps/web/main.tsx"), surface = /\/apps\/web\/surfaces\/([a-z][a-z0-9-]*)\//.exec(id)?.[1];
    if ((!main && !surface) || !id.endsWith(".tsx")) return;
    let roots = 0;
    const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const transformed = ts.transform(source, [context => node => {
      const visit: ts.Visitor = child => {
        if (surface && (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && ts.isIdentifier(child.tagName) && /^[a-z]/.test(child.tagName.text)) {
          const attributes = ts.factory.createJsxAttributes([...child.attributes.properties, ts.factory.createJsxAttribute(ts.factory.createIdentifier("data-preview-surface"), ts.factory.createStringLiteral(surface))]);
          return ts.isJsxOpeningElement(child) ? ts.factory.updateJsxOpeningElement(child, child.tagName, child.typeArguments, attributes) : ts.factory.updateJsxSelfClosingElement(child, child.tagName, child.typeArguments, attributes);
        }
        if (main && ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "render") {
          if (child.arguments.length !== 1) throw new Error("Preview requires one React root argument");
          roots++;
          return ts.factory.updateCallExpression(child, child.expression, child.typeArguments, [ts.factory.createCallExpression(ts.factory.createIdentifier("__gaiaWrap"), undefined, [child.arguments[0]])]);
        }
        return ts.visitEachChild(child, visit, context);
      };
      return ts.visitNode(node, visit) as ts.SourceFile;
    }]);
    try {
      if (main && roots !== 1) throw new Error("Preview requires exactly one React root");
      const printed = ts.createPrinter().printFile(transformed.transformed[0]);
      if (!main) return printed;
      return 'import { Preview as __GaiaPreview } from "./ui/preview"; import { createElement as __gaiaElement } from "react"; function __gaiaWrap(node) { return __gaiaElement(__GaiaPreview, {state:new URL(location.href).searchParams.get("__gaia_state") || undefined}, node); }\n' + printed;
    } finally { transformed.dispose(); }
  } }],
  build: { emptyOutDir: true },
});
