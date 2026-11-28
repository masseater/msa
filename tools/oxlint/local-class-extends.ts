import type { Context, ESTree } from "vite-plus/lint/plugins";
import { defineRule } from "vite-plus/lint/plugins";

import classOrigin from "./class-origin.ts";
import type localClassExtendsTypes from "./local-class-extends.types.ts";
import reporter from "./reporter.ts";
import sharedWrite from "./shared-write.ts";
import StaticString from "./static-string.ts";

const LOCAL_EXTENDS_MESSAGE =
  "同じパッケージで定義したクラスを継承しない。責務ごとの部品をフィールドに持たせ、委譲して組む";
const PROTOTYPE_MESSAGE =
  "setPrototypeOf や __proto__ で prototype を書き換えない。継承は class 宣言の extends だけで決める";
const SHARED_WRITE_MESSAGE =
  "package から import した値を書き換えない。差し替える値は引数か Layer で渡す";
const PROTOTYPE_NAMES: ReadonlySet<string> = new Set(["__proto__", "setPrototypeOf"]);

type Node = ESTree.Node;

const classExtendsOptions = (context: Context): localClassExtendsTypes.ClassExtendsOptions => {
  const [options] = context.options as unknown as readonly (
    | localClassExtendsTypes.ClassExtendsOptions
    | undefined
  )[];
  if (options === undefined)
    throw new TypeError("msa/no-local-class-extends には builtins と packages と probeRoot を渡す");
  return options;
};

const sourcePathOf = (filename: string, probeRoot: string): string => {
  if (!filename.startsWith(`${probeRoot}/`)) return filename;
  const inRun = filename.slice(probeRoot.length + 1);
  return `${probeRoot.slice(0, probeRoot.lastIndexOf("/"))}/${inRun.slice(inRun.indexOf("/") + 1)}`;
};

const selfSpecifiersOf = (
  context: Context,
  { packages, probeRoot }: localClassExtendsTypes.ClassExtendsOptions,
): readonly string[] =>
  packages
    .filter(({ dir }) => sourcePathOf(context.filename, probeRoot).startsWith(`${dir}/`))
    .reduce<localClassExtendsTypes.WorkspacePackage | undefined>(
      (owner, candidate) =>
        owner === undefined || candidate.dir.length > owner.dir.length ? candidate : owner,
      undefined,
    )?.specifiers ?? [];

const packagesSchema = {
  items: [
    {
      additionalProperties: false,
      properties: {
        builtins: { items: { type: "string" }, type: "array" },
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
        probeRoot: { type: "string" },
      },
      required: ["builtins", "packages", "probeRoot"],
      type: "object",
    },
  ],
  maxItems: 1,
  minItems: 1,
  type: "array",
} as const;

const noLocalClassExtends = defineRule({
  create(context) {
    const options = classExtendsOptions(context);
    const walk = {
      builtins: new Set(options.builtins),
      context,
      selfSpecifiers: selfSpecifiersOf(context, options),
    };
    const strings = new StaticString(context);
    const reportPrototype = reporter.createReporter(context, PROTOTYPE_MESSAGE);
    const checkName = (node: Node, name: string | undefined): void => {
      if (PROTOTYPE_NAMES.has(name ?? "")) reportPrototype(node);
    };
    const checkString = (node: Node): void => checkName(node, strings.fold(node));
    const shared = sharedWrite.createSharedWrite(
      walk,
      reporter.createReporter(context, SHARED_WRITE_MESSAGE),
    );
    const check = (node: ESTree.Class): void => {
      if (node.superClass !== null && classOrigin.declaredInPackage(walk, node.superClass))
        context.report({ message: LOCAL_EXTENDS_MESSAGE, node: node.superClass });
    };
    return {
      ...shared,
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

const localClassExtends = { noLocalClassExtends };

export default localClassExtends;
