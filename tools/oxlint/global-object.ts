import type { ESTree } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Walk = classRootTypes.Walk;

const { parentOf, staticKey, unwrap } = classRoot;

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set([
  "frames",
  "global",
  "globalThis",
  "parent",
  "self",
  "top",
  "window",
]);

const CODE_RUNNERS: ReadonlySet<string> = new Set(["Function", "eval"]);

const strip = (node: Node): Node => {
  const value = unwrap(node);
  return value.type === "ChainExpression" ? strip(value.expression) : value;
};

const isGlobalNamed = (walk: Walk, node: Node, names: ReadonlySet<string>): boolean =>
  scopeLookup.isGlobalNamed(walk.context, node, names);

const memberKey = (node: Node): string | undefined =>
  node.type === "MemberExpression" ? staticKey(node) : undefined;

const isCall = (node: Node): node is ESTree.CallExpression | ESTree.NewExpression =>
  node.type === "CallExpression" || node.type === "NewExpression";

const hasKeyIn = (names: ReadonlySet<string>, node: Node): boolean => {
  const key = memberKey(node);
  return key !== undefined && names.has(key);
};

const isNamedGlobal = (walk: Walk, value: Node, names: ReadonlySet<string>): boolean =>
  isGlobalNamed(walk, value, names) ||
  (value.type === "MemberExpression" &&
    hasKeyIn(names, value) &&
    isGlobalObject(walk, value.object));

const CONSTRUCTOR_KEYS: ReadonlySet<string> = new Set(["constructor"]);

const isCodeRunner = (walk: Walk, node: Node): boolean =>
  isNamedGlobal(walk, strip(node), CODE_RUNNERS);

function runsCode(walk: Walk, callee: Node): boolean {
  const value = strip(callee);
  if (isCall(value)) return runsCode(walk, value.callee);
  return hasKeyIn(CONSTRUCTOR_KEYS, value) || isCodeRunner(walk, value);
}

function isGlobalObject(walk: Walk, node: Node): boolean {
  const value = strip(node);
  return isCall(value) ? runsCode(walk, value.callee) : isNamedGlobal(walk, value, GLOBAL_OBJECTS);
}

const climbOut = (node: Node): Node => {
  const parent = parentOf(node);
  return parent !== null && strip(parent) === strip(node) ? climbOut(parent) : node;
};

const isCalleeOf = (node: Node): boolean => {
  const outer = climbOut(node);
  const parent = parentOf(outer);
  return parent !== null && isCall(parent) && parent.callee === outer;
};

const isAliasInit = (node: Node): boolean => {
  const outer = climbOut(node);
  const parent = parentOf(outer);
  return parent?.type === "VariableDeclarator" && parent.init === outer;
};

const GLOBAL_STAYS: Readonly<
  Partial<Record<Node["type"], (walk: Walk, node: Node, parent: Node) => boolean>>
> = {
  CallExpression: (walk, node, parent) =>
    (parent as ESTree.CallExpression).callee === node && isGlobalObject(walk, parent),
  MemberExpression: (_walk, node, parent) => (parent as ESTree.MemberExpression).object === node,
  NewExpression: (walk, node, parent) =>
    (parent as ESTree.NewExpression).callee === node && isGlobalObject(walk, parent),
  UnaryExpression: (_walk, _node, parent) =>
    (parent as ESTree.UnaryExpression).operator === "typeof",
};

const isTypeOnly = (parent: Node): boolean =>
  parent.type.startsWith("TS") && parent.type !== "TSExportAssignment";

const inTypePosition = (node: Node): boolean => {
  const parent = parentOf(climbOut(node));
  return parent !== null && isTypeOnly(parent);
};

const staysGlobal = (walk: Walk, node: Node): boolean => {
  const outer = climbOut(node);
  const parent = parentOf(outer);
  return (
    parent !== null &&
    (isTypeOnly(parent) || GLOBAL_STAYS[parent.type]?.(walk, outer, parent) === true)
  );
};

const globalObject = {
  hasKeyIn,
  inTypePosition,
  isAliasInit,
  isCalleeOf,
  isCodeRunner,
  isGlobalNamed,
  isGlobalObject,
  memberKey,
  staysGlobal,
  strip,
};

export default globalObject;
