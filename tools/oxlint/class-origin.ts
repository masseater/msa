import type { Context, Definition, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Walk = {
  readonly visited: { readonly functions: Set<Node>; readonly classes: Set<Node> };
  readonly functionsCount: boolean;
};

type DefinitionCheck = (context: Context, def: Definition, walk: Walk) => boolean;

const isRelative = (specifier: string): boolean => specifier.startsWith(".");

const fromImport: DefinitionCheck = (_context, def) =>
  isRelative((def.parent as ESTree.ImportDeclaration).source.value);

const fromVariable: DefinitionCheck = (context, def, walk) => {
  const init = def.node.type === "VariableDeclarator" ? def.node.init : null;
  return init !== null && declaredIn(context, init, walk);
};

const DEFINITIONS: Readonly<Partial<Record<Definition["type"], DefinitionCheck>>> = {
  ClassName: () => true,
  FunctionName: (_context, _def, walk) => walk.functionsCount,
  ImportBinding: fromImport,
  Variable: fromVariable,
};

const fromIdentifier = (context: Context, node: Node, walk: Walk): boolean =>
  scopeLookup
    .variableOf(context, node)
    ?.defs.some((def) => DEFINITIONS[def.type]?.(context, def, walk) === true) === true;

const fromCall = (context: Context, node: ESTree.CallExpression, walk: Walk): boolean => {
  const asClass = { ...walk, functionsCount: false };
  return (
    declaredIn(context, node.callee, { ...walk, functionsCount: true }) ||
    node.arguments.some((argument) =>
      declaredIn(
        context,
        argument.type === "SpreadElement" ? argument.argument : argument,
        asClass,
      ),
    )
  );
};

type NodeCheck = (context: Context, node: Node, walk: Walk) => boolean;

const local: NodeCheck = () => true;

const localFunction: NodeCheck = (_context, _node, walk) => walk.functionsCount;

const NODES: Readonly<Partial<Record<Node["type"], NodeCheck>>> = {
  ArrowFunctionExpression: localFunction,
  CallExpression: (context, node, walk) => fromCall(context, node as ESTree.CallExpression, walk),
  ClassExpression: local,
  FunctionExpression: localFunction,
  Identifier: fromIdentifier,
  MemberExpression: (context, node, walk) =>
    declaredIn(context, (node as ESTree.MemberExpression).object, walk),
  TSInstantiationExpression: (context, node, walk) =>
    declaredIn(context, (node as ESTree.TSInstantiationExpression).expression, walk),
};

function declaredIn(context: Context, node: Node, walk: Walk): boolean {
  const visited = walk.functionsCount ? walk.visited.functions : walk.visited.classes;
  if (visited.has(node)) return false;
  visited.add(node);
  return NODES[node.type]?.(context, node, walk) === true;
}

const declaredInPackage = (context: Context, node: Node): boolean =>
  declaredIn(context, node, {
    functionsCount: true,
    visited: { classes: new Set(), functions: new Set() },
  });

const classOrigin = { declaredInPackage };

export default classOrigin;
