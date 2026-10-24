import type { Context, ESTree } from "vite-plus/lint/plugins";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

import classOrigin from "./class-origin.ts";
import type flowTypes from "./flow.types.ts";
import LookupFlow from "./lookup-flow.ts";
import RequireFlow from "./require-flow.ts";
import restrictedMember from "./restricted-member.ts";
import StaticString from "./static-string.ts";

const LOOKUP = "getBuiltinModule";
const LOOKUP_MESSAGE =
  "process.getBuiltinModule や process.binding で組み込みを探さない。静的 import で読み、platform 層を通して使う";
const LOOKUP_UNKNOWN_MESSAGE =
  "process や globalThis をこの形で使うと getBuiltinModule や binding に届くかを判定できない。静的なキーで読む";
const REQUIRE_MESSAGE =
  "require や動的 import で組み込みを読まない。Effect の API か platform 層を通して使う";
const REQUIRE_UNKNOWN_MESSAGE =
  "require・createRequire・import() をこの形で使うと読み込む先を判定できない。文字列リテラルで直接呼ぶ";
const LOCAL_EXTENDS_MESSAGE =
  "同じパッケージで定義したクラスを継承しない。責務ごとの部品をフィールドに持たせ、委譲して組む";
const PROTOTYPE_MESSAGE =
  "setPrototypeOf や __proto__ で prototype を書き換えない。継承は class 宣言の extends だけで決める";
const PROTOTYPE_NAMES: ReadonlySet<string> = new Set(["__proto__", "setPrototypeOf"]);
const SYNC_FS_MESSAGE =
  "同期の fs を使わない。Effect の FileSystem か platform の非同期 API を使い、同期が要るなら platform/node の名前付き関数に閉じる";

type Node = flowTypes.Node;

const stringOptions = (context: Context, name: string): ReadonlySet<string> => {
  const [options] = context.options as readonly (Record<string, readonly string[]> | undefined)[];
  return new Set(options?.[name] ?? []);
};

const createReporter = (context: Context, message: string) => {
  const reported = new Set<number>();
  return (node: Node): void => {
    if (reported.has(node.start)) return;
    reported.add(node.start);
    context.report({ message, node });
  };
};

const listSchema = (name: string) => [
  {
    additionalProperties: false,
    properties: { [name]: { items: { type: "string" }, type: "array" } },
    type: "object",
  },
];

const noBuiltinModuleLookup = defineRule({
  create(context) {
    const report = createReporter(context, LOOKUP_MESSAGE);
    const lookup = new LookupFlow({
      context,
      report: { restricted: report, unknown: createReporter(context, LOOKUP_UNKNOWN_MESSAGE) },
    });
    const reportLookup = (node: Node): void => {
      if (lookup.isLookup(node)) report(node);
    };
    return {
      BinaryExpression: reportLookup,
      Identifier(node) {
        if (node.name === LOOKUP) report(node);
      },
      ImportDeclaration: (node) => lookup.fromImport(node),
      Literal: reportLookup,
      Program: () => lookup.fromGlobals(),
      TemplateLiteral: reportLookup,
    };
  },
  meta: { type: "problem" },
});

const noBuiltinRequire = defineRule({
  create(context) {
    const flow = new RequireFlow({
      context,
      report: {
        restricted: createReporter(context, REQUIRE_MESSAGE),
        unknown: createReporter(context, REQUIRE_UNKNOWN_MESSAGE),
      },
    });
    return {
      CallExpression: (node) => flow.fromMemberCall(node),
      ExportAllDeclaration: (node) => flow.fromReExport(node),
      ExportNamedDeclaration: (node) => flow.fromReExport(node),
      ImportDeclaration: (node) => flow.fromImport(node),
      ImportExpression: (node) => flow.fromDynamicImport(node),
      MemberExpression: (node) => flow.fromFactoryName(node),
      Program: () => flow.fromGlobals(),
      Property(node) {
        if (node.parent.type === "ObjectPattern")
          flow.fromFactoryName(node as ESTree.BindingProperty);
      },
      TSExternalModuleReference(node) {
        flow.checkSpecifier(node.expression, node);
      },
    };
  },
  meta: { schema: listSchema("modules"), type: "problem" },
});

const noSyncFs = defineRule({
  create(context) {
    const names = stringOptions(context, "names");
    const strings = new StaticString(context);
    const report = createReporter(context, SYNC_FS_MESSAGE);
    const nameOf = (node: Node): string | undefined =>
      node.type === "Identifier" ? node.name : strings.fold(node);
    const reportName = (node: Node): void => {
      if (names.has(nameOf(node) ?? "")) report(node);
    };
    return {
      BinaryExpression: reportName,
      Identifier: reportName,
      Literal: reportName,
      TemplateLiteral: reportName,
    };
  },
  meta: { schema: listSchema("names"), type: "problem" },
});

type WorkspacePackage = { readonly dir: string; readonly specifiers: readonly string[] };

const packagesOption = (context: Context): readonly WorkspacePackage[] => {
  const [options] = context.options as readonly (
    | { packages?: readonly WorkspacePackage[] }
    | undefined
  )[];
  return options?.packages ?? [];
};

const selfSpecifiersOf = (context: Context): readonly string[] =>
  packagesOption(context)
    .filter(({ dir }) => context.filename.startsWith(`${dir}/`))
    .reduce<WorkspacePackage | undefined>(
      (owner, candidate) =>
        owner === undefined || candidate.dir.length > owner.dir.length ? candidate : owner,
      undefined,
    )?.specifiers ?? [];

const packagesSchema = [
  {
    additionalProperties: false,
    properties: {
      packages: {
        items: {
          additionalProperties: false,
          properties: {
            dir: { type: "string" },
            specifiers: { items: { type: "string" }, type: "array" },
          },
          required: ["dir", "specifiers"],
          type: "object",
        },
        type: "array",
      },
    },
    type: "object",
  },
];

const noLocalClassExtends = defineRule({
  create(context) {
    const selfSpecifiers = selfSpecifiersOf(context);
    const strings = new StaticString(context);
    const reportPrototype = createReporter(context, PROTOTYPE_MESSAGE);
    const checkName = (node: Node, name: string | undefined): void => {
      if (PROTOTYPE_NAMES.has(name ?? "")) reportPrototype(node);
    };
    const checkString = (node: Node): void => checkName(node, strings.fold(node));
    const check = (node: ESTree.Class): void => {
      if (
        node.superClass !== null &&
        classOrigin.declaredInPackage(context, node.superClass, selfSpecifiers)
      )
        context.report({ message: LOCAL_EXTENDS_MESSAGE, node: node.superClass });
    };
    return {
      BinaryExpression: checkString,
      ClassDeclaration: check,
      ClassExpression: check,
      Identifier: (node) => checkName(node, node.name),
      Literal: checkString,
      TemplateLiteral: checkString,
    };
  },
  meta: { schema: packagesSchema, type: "problem" },
});

const noRestrictedMember = defineRule({
  create(context) {
    const members = restrictedMember.restrictedMembersOf(context);
    return {
      ImportDeclaration(node) {
        for (const member of members) restrictedMember.checkImport(context, node, member);
      },
    };
  },
  meta: {
    schema: [
      {
        additionalProperties: false,
        properties: {
          members: {
            items: {
              additionalProperties: false,
              properties: {
                message: { type: "string" },
                module: { type: "string" },
                path: { items: { type: "string" }, minItems: 1, type: "array" },
              },
              required: ["message", "module", "path"],
              type: "object",
            },
            type: "array",
          },
        },
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
    "no-local-class-extends": noLocalClassExtends,
    "no-restricted-member": noRestrictedMember,
    "no-sync-fs": noSyncFs,
  },
});

export default msaPlugin;
