import type { ESTree, Variable } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Seen = ReadonlySet<Variable>;

const { isPackageImport, unwrap } = classRoot;

const strip = (node: flowTypes.Node): flowTypes.Node => {
  const value = unwrap(node);
  return value.type === "ChainExpression" ? strip(value.expression) : value;
};

const writesOf = (variable: Variable): readonly flowTypes.Node[] =>
  variable.references.flatMap(({ writeExpr }) =>
    writeExpr === null || writeExpr === undefined ? [] : [writeExpr],
  );

const isSharedBinding = (
  walk: classRootTypes.Walk,
  identifier: flowTypes.Node,
  seen: Seen,
): boolean => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  if (variable === undefined || seen.has(variable)) return false;
  if (isPackageImport(walk, variable.defs)) return true;
  const next = new Set([...seen, variable]);
  return writesOf(variable).some((write) => reachesShared(walk, write, next));
};

const SHARED_STEPS: Readonly<
  Partial<
    Record<
      flowTypes.Node["type"],
      (walk: classRootTypes.Walk, node: flowTypes.Node, seen: Seen) => boolean
    >
  >
> = {
  Identifier: (walk, node, seen) => isSharedBinding(walk, node, seen),
  MemberExpression: (walk, node, seen) =>
    reachesShared(walk, (node as ESTree.MemberExpression).object, seen),
};

function reachesShared(walk: classRootTypes.Walk, node: flowTypes.Node, seen: Seen): boolean {
  const value = strip(node);
  return SHARED_STEPS[value.type]?.(walk, value, seen) === true;
}

const PATTERN_TARGETS: Readonly<
  Partial<Record<flowTypes.Node["type"], (node: flowTypes.Node) => readonly flowTypes.Node[]>>
> = {
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
  RestElement: (node) => targetsOf((node as { readonly argument: flowTypes.Node }).argument),
};

function targetsOf(node: flowTypes.Node): readonly flowTypes.Node[] {
  const value = strip(node);
  return PATTERN_TARGETS[value.type]?.(value) ?? [];
}

const WRITING_APIS: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["assign", "defineProperties", "defineProperty"]),
  Reflect: new Set(["defineProperty", "deleteProperty", "set"]),
};

const WRITING_OWNERS: ReadonlySet<string> = new Set(Object.keys(WRITING_APIS));

const isWritingApi = (walk: classRootTypes.Walk, callee: flowTypes.Node): boolean => {
  if (callee.type !== "MemberExpression") return false;
  const { object } = callee;
  if (!scopeLookup.isGlobalNamed(walk.context, object, WRITING_OWNERS)) return false;
  const name = scopeLookup.staticMemberName(callee);
  return name !== undefined && WRITING_APIS[(object as ESTree.IdentifierReference).name]!.has(name);
};

const writtenArgument = (
  walk: classRootTypes.Walk,
  call: ESTree.CallExpression,
): flowTypes.Node | undefined => {
  const [target] = call.arguments;
  return target?.type !== "SpreadElement" && isWritingApi(walk, strip(call.callee))
    ? target
    : undefined;
};

const createSharedWrite = (walk: classRootTypes.Walk, report: (node: flowTypes.Node) => void) => {
  const checkTargets = (target: flowTypes.Node): void => {
    for (const member of targetsOf(target) as readonly ESTree.MemberExpression[])
      if (reachesShared(walk, member.object, new Set())) report(member);
  };
  return {
    AssignmentExpression: (node: ESTree.AssignmentExpression) => checkTargets(node.left),
    CallExpression: (node: ESTree.CallExpression) => {
      const target = writtenArgument(walk, node);
      if (target !== undefined && reachesShared(walk, target, new Set())) report(target);
    },
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
