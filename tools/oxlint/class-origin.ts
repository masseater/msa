import type { Context, Definition, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Visited = Set<Node>;

type DefinitionCheck = (context: Context, def: Definition, visited: Visited) => boolean;

const isRelative = (specifier: string): boolean => specifier.startsWith(".");

const fromImport: DefinitionCheck = (_context, def) =>
  isRelative((def.parent as ESTree.ImportDeclaration).source.value);

const fromVariable: DefinitionCheck = (context, def, visited) => {
  const init = def.node.type === "VariableDeclarator" ? def.node.init : null;
  return init !== null && declaredIn(context, init, visited);
};

const DEFINITIONS: Readonly<Partial<Record<Definition["type"], DefinitionCheck>>> = {
  ClassName: () => true,
  FunctionName: () => true,
  ImportBinding: fromImport,
  Variable: fromVariable,
};

const fromIdentifier = (context: Context, node: Node, visited: Visited): boolean =>
  scopeLookup
    .variableOf(context, node)
    ?.defs.some((def) => DEFINITIONS[def.type]?.(context, def, visited) === true) === true;

const fromCall = (context: Context, node: ESTree.CallExpression, visited: Visited): boolean =>
  [node.callee, ...node.arguments].some((part) =>
    declaredIn(context, part.type === "SpreadElement" ? part.argument : part, visited),
  );

function declaredIn(context: Context, node: Node, visited: Visited): boolean {
  if (visited.has(node)) return false;
  visited.add(node);
  switch (node.type) {
    case "ArrowFunctionExpression":
    case "ClassExpression":
    case "FunctionExpression":
      return true;
    case "CallExpression":
      return fromCall(context, node, visited);
    case "Identifier":
      return fromIdentifier(context, node, visited);
    case "MemberExpression":
      return declaredIn(context, node.object, visited);
    case "TSInstantiationExpression":
      return declaredIn(context, node.expression, visited);
    default:
      return false;
  }
}

const declaredInPackage = (context: Context, node: Node): boolean =>
  declaredIn(context, node, new Set());

const classOrigin = { declaredInPackage };

export default classOrigin;
