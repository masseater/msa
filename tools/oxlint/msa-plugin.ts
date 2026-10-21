import type { Context, ESTree } from "vite-plus/lint/plugins";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

const LOOKUP = "getBuiltinModule";
const LOOKUP_MESSAGE =
  "process.getBuiltinModule で組み込みを探さない。静的 import で読み、platform 層を通して使う";
const REQUIRE_MESSAGE =
  "require や動的 import で組み込みを読まない。Effect の API か platform 層を通して使う";

const staticString = (node: ESTree.Node | null | undefined): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
};

const moduleBase = (specifier: string): string =>
  specifier.replace(/^node:/u, "").split("/")[0] ?? specifier;

const optionModules = (context: Context): ReadonlySet<string> => {
  const [options] = context.options as readonly ({ modules?: readonly string[] } | undefined)[];
  return new Set(options?.modules ?? []);
};

const isCreateRequireCall = (node: ESTree.Node | null | undefined): boolean =>
  node?.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  node.callee.name === "createRequire";

const noBuiltinModuleLookup = defineRule({
  create(context) {
    const report = (node: ESTree.Node): void => context.report({ message: LOOKUP_MESSAGE, node });
    return {
      Identifier(node) {
        if (node.name === LOOKUP) report(node);
      },
      Literal(node) {
        if (node.value === LOOKUP) report(node);
      },
      TemplateLiteral(node) {
        if (staticString(node) === LOOKUP) report(node);
      },
    };
  },
  meta: { type: "problem" },
});

const noBuiltinRequire = defineRule({
  create(context) {
    const modules = optionModules(context);
    const requireNames = new Set(["require"]);
    const restricted = (node: ESTree.Node | null | undefined): boolean => {
      const specifier = staticString(node);
      return specifier !== undefined && modules.has(moduleBase(specifier));
    };
    const isRequire = (callee: ESTree.Node): boolean =>
      (callee.type === "Identifier" && requireNames.has(callee.name)) ||
      isCreateRequireCall(callee) ||
      (callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        callee.property.name === "require");
    const report = (node: ESTree.Node): void => context.report({ message: REQUIRE_MESSAGE, node });
    return {
      CallExpression(node) {
        if (isRequire(node.callee) && restricted(node.arguments[0])) report(node);
      },
      ImportExpression(node) {
        if (restricted(node.source)) report(node);
      },
      TSExternalModuleReference(node) {
        if (restricted(node.expression)) report(node);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && isCreateRequireCall(node.init))
          requireNames.add(node.id.name);
      },
    };
  },
  meta: {
    schema: [
      {
        additionalProperties: false,
        properties: { modules: { items: { type: "string" }, type: "array" } },
        type: "object",
      },
    ],
    type: "problem",
  },
});

const msaPlugin = definePlugin({
  meta: { name: "msa" },
  rules: {
    "no-builtin-module-lookup": noBuiltinModuleLookup,
    "no-builtin-require": noBuiltinRequire,
  },
});

export default msaPlugin;
