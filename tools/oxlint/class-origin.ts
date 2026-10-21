import type { Context, Definition, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

const rootIdentifier = (node: Node): Node => {
  if (node.type === "MemberExpression") return rootIdentifier(node.object);
  if (node.type === "CallExpression") return rootIdentifier(node.callee);
  if (node.type === "TSInstantiationExpression") return rootIdentifier(node.expression);
  return node;
};

const isRelative = (specifier: string): boolean => specifier.startsWith(".");

type DefinitionCheck = (context: Context, def: Definition, depth: number) => boolean;

const MAX_DEPTH = 8;

const fromImport: DefinitionCheck = (_context, def) =>
  isRelative((def.parent as ESTree.ImportDeclaration).source.value);

const fromVariable: DefinitionCheck = (context, def, depth) => {
  const init = def.node.type === "VariableDeclarator" ? def.node.init : null;
  if (init === null) return false;
  return init.type === "ClassExpression" || declaredInPackage(context, init, depth + 1);
};

const DEFINITIONS: Readonly<Partial<Record<Definition["type"], DefinitionCheck>>> = {
  ClassName: () => true,
  ImportBinding: fromImport,
  Variable: fromVariable,
};

function declaredInPackage(context: Context, node: Node, depth = 0): boolean {
  const variable = scopeLookup.variableOf(context, rootIdentifier(node));
  if (variable === undefined || depth > MAX_DEPTH) return false;
  return variable.defs.some((def) => DEFINITIONS[def.type]?.(context, def, depth) === true);
}

const classOrigin = { declaredInPackage };

export default classOrigin;
