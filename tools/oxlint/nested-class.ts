import type { ESTree } from "vite-plus/lint/plugins";
import { defineRule } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";

type Node = flowTypes.Node;

const MESSAGE =
  "class はモジュールの直下（export・変数の初期化を含む）に書く。読み込んだ時点で全 class が定義され、継承元の検査が全 class に掛かるようにする";

const MODULE_LEVEL: ReadonlySet<Node["type"]> = new Set([
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "VariableDeclaration",
  "VariableDeclarator",
]);

const isModuleLevel = (node: Node): boolean => {
  const parent = node.parent as Node | null;
  if (parent === null || parent.type === "Program") return true;
  return MODULE_LEVEL.has(parent.type) && isModuleLevel(parent);
};

const noNestedClass = defineRule({
  create(context) {
    const check = (node: ESTree.Class): void => {
      if (node.declare !== true && !isModuleLevel(node as Node))
        context.report({ message: MESSAGE, node });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
  meta: { type: "problem" },
});

const nestedClass = { noNestedClass };

export default nestedClass;
