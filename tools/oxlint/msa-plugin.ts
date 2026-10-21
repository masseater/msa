import type { Context, ESTree } from "vite-plus/lint/plugins";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import LookupFlow from "./lookup-flow.ts";
import RequireFlow from "./require-flow.ts";
import StaticString from "./static-string.ts";

const LOOKUP = "getBuiltinModule";
const LOOKUP_MESSAGE =
  "process.getBuiltinModule で組み込みを探さない。静的 import で読み、platform 層を通して使う";
const LOOKUP_UNKNOWN_MESSAGE =
  "process や globalThis をこの形で使うと getBuiltinModule に届くかを判定できない。静的なキーで読む";
const REQUIRE_MESSAGE =
  "require や動的 import で組み込みを読まない。Effect の API か platform 層を通して使う";
const REQUIRE_UNKNOWN_MESSAGE =
  "require・createRequire・import() をこの形で使うと読み込む先を判定できない。文字列リテラルで直接呼ぶ";
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
      unknown: createReporter(context, LOOKUP_UNKNOWN_MESSAGE),
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

const msaPlugin = definePlugin({
  meta: { name: "msa" },
  rules: {
    "no-builtin-module-lookup": noBuiltinModuleLookup,
    "no-builtin-require": noBuiltinRequire,
    "no-sync-fs": noSyncFs,
  },
});

export default msaPlugin;
