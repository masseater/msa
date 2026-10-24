import type { ESTree, Variable } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Walk = classRootTypes.Walk;

type Seen = ReadonlySet<Variable>;

const { isPackageImport, unwrap } = classRoot;

const strip = (node: Node): Node => {
  const value = unwrap(node);
  return value.type === "ChainExpression" ? strip(value.expression) : value;
};

const writesOf = (variable: Variable): readonly Node[] =>
  variable.references.flatMap(({ writeExpr }) =>
    writeExpr === null || writeExpr === undefined ? [] : [writeExpr],
  );

const isSharedBinding = (walk: Walk, identifier: Node, seen: Seen): boolean => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  if (variable === undefined || seen.has(variable)) return false;
  if (isPackageImport(walk, variable.defs)) return true;
  const next = new Set([...seen, variable]);
  return writesOf(variable).some((write) => reachesShared(walk, write, next));
};

const SHARED_STEPS: Readonly<
  Partial<Record<Node["type"], (walk: Walk, node: Node, seen: Seen) => boolean>>
> = {
  Identifier: (walk, node, seen) => isSharedBinding(walk, node, seen),
  MemberExpression: (walk, node, seen) =>
    reachesShared(walk, (node as ESTree.MemberExpression).object, seen),
};

function reachesShared(walk: Walk, node: Node, seen: Seen): boolean {
  const value = strip(node);
  return SHARED_STEPS[value.type]?.(walk, value, seen) === true;
}

const PATTERN_TARGETS: Readonly<Partial<Record<Node["type"], (node: Node) => readonly Node[]>>> = {
  ArrayPattern: (node) =>
    (node as ESTree.ArrayPattern).elements.flatMap((element) =>
      element === null ? [] : targetsOf(element),
    ),
  AssignmentPattern: (node) => targetsOf((node as ESTree.AssignmentPattern).left),
  MemberExpression: (node) => [node],
  ObjectPattern: (node) =>
    (node as ESTree.ObjectPattern).properties.flatMap((property) =>
      targetsOf(property.type === "RestElement" ? property.argument : property.value),
    ),
  RestElement: (node) => targetsOf((node as { readonly argument: Node }).argument),
};

function targetsOf(node: Node): readonly Node[] {
  const value = strip(node);
  return PATTERN_TARGETS[value.type]?.(value) ?? [];
}

const createSharedWrite = (walk: Walk, report: (node: Node) => void) => {
  const checkTargets = (target: Node): void => {
    for (const member of targetsOf(target) as readonly ESTree.MemberExpression[])
      if (reachesShared(walk, member.object, new Set())) report(member);
  };
  return {
    AssignmentExpression: (node: ESTree.AssignmentExpression) => checkTargets(node.left),
    ForInStatement: (node: ESTree.ForInStatement) => checkTargets(node.left),
    ForOfStatement: (node: ESTree.ForOfStatement) => checkTargets(node.left),
    UnaryExpression: (node: ESTree.UnaryExpression) => {
      if (node.operator === "delete") checkTargets(node.argument);
    },
    UpdateExpression: (node: ESTree.UpdateExpression) => checkTargets(node.argument),
  };
};

const sharedWrite = { createSharedWrite };

export default sharedWrite;
