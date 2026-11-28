import type { ESTree } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";

type Root = classRootTypes.Root;

const { TRANSPARENT, isFactoryCallee, isFactoryKey, parentOf, rootOf, staticKey, unwrap } =
  classRoot;

type Chain = { readonly top: flowTypes.Node; readonly keys: readonly (string | undefined)[] };

type Position = (node: flowTypes.Node, parent: flowTypes.Node) => boolean;

type WalkPosition = (
  walk: classRootTypes.Walk,
  node: flowTypes.Node,
  parent: flowTypes.Node,
) => boolean;

const FUNCTIONS: ReadonlySet<flowTypes.Node["type"]> = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const PATTERNS: ReadonlySet<flowTypes.Node["type"]> = new Set([
  "ArrayPattern",
  "AssignmentPattern",
  "ObjectPattern",
  "RestElement",
]);

const climbsThrough = (parent: flowTypes.Node): boolean =>
  TRANSPARENT.has(parent.type) || parent.type === "ChainExpression";

const climbStep = (
  top: flowTypes.Node,
  parent: flowTypes.Node,
  keys: Chain["keys"],
): Chain | undefined => {
  if (climbsThrough(parent)) return { keys, top: parent };
  return parent.type === "MemberExpression" && parent.object === top
    ? { keys: [...keys, staticKey(parent)], top: parent }
    : undefined;
};

const climb = (top: flowTypes.Node, keys: Chain["keys"]): Chain => {
  const parent = parentOf(top);
  const next = parent === null ? undefined : climbStep(top, parent, keys);
  return next === undefined ? { keys, top } : climb(next.top, next.keys);
};

const leftIs: Position = (node, parent) =>
  (parent as { readonly left: flowTypes.Node }).left === node;

const inPattern: Position = (node, parent) => {
  const holder = parentOf(parent);
  return (
    holder !== null && PATTERNS.has(holder.type) && (parent as ESTree.ObjectProperty).value === node
  );
};

const WRITES: Readonly<Partial<Record<flowTypes.Node["type"], Position>>> = {
  ArrayPattern: () => true,
  AssignmentExpression: leftIs,
  AssignmentPattern: leftIs,
  ForInStatement: leftIs,
  ForOfStatement: leftIs,
  Property: inPattern,
  RestElement: () => true,
  UnaryExpression: (_node, parent) => (parent as ESTree.UnaryExpression).operator === "delete",
  UpdateExpression: () => true,
};

const calleeIs: Position = (node, parent) =>
  (parent as ESTree.CallExpression | ESTree.NewExpression).callee === node;

const superClassIs: Position = (node, parent) => (parent as ESTree.Class).superClass === node;

const climbOut = (node: flowTypes.Node): flowTypes.Node => {
  const parent = parentOf(node);
  return parent !== null && TRANSPARENT.has(parent.type) ? climbOut(parent) : node;
};

const isFactoryArgument = (walk: classRootTypes.Walk, node: flowTypes.Node): boolean => {
  const argument = climbOut(node);
  const call = parentOf(argument);
  return (
    call?.type === "CallExpression" &&
    call.arguments.includes(argument as ESTree.Argument) &&
    isFactoryCallee(walk, call.callee)
  );
};

const enclosingFunction = (node: flowTypes.Node): flowTypes.Node | null => {
  const parent = parentOf(node);
  return parent === null || FUNCTIONS.has(parent.type) ? parent : enclosingFunction(parent);
};

const isFactoryArrow = (walk: classRootTypes.Walk, fn: flowTypes.Node | null): boolean =>
  fn?.type === "ArrowFunctionExpression" && !fn.async && isFactoryArgument(walk, fn);

const STAYS: Readonly<Partial<Record<flowTypes.Node["type"], WalkPosition>>> = {
  ArrowFunctionExpression: (walk, node, parent) =>
    (parent as ESTree.ArrowFunctionExpression).body === node && isFactoryArrow(walk, parent),
  BinaryExpression: (_walk, node, parent) => {
    const binary = parent as ESTree.BinaryExpression;
    return binary.operator === "instanceof" && binary.right === node;
  },
  CallExpression: (walk, node) => isFactoryArgument(walk, node),
  ClassDeclaration: (_walk, node, parent) => superClassIs(node, parent),
  ClassExpression: (_walk, node, parent) => superClassIs(node, parent),
  NewExpression: (_walk, node, parent) => calleeIs(node, parent),
  ReturnStatement: (walk, node, parent) =>
    (parent as ESTree.ReturnStatement).argument === node &&
    isFactoryArrow(walk, enclosingFunction(parent)),
  UnaryExpression: (_walk, _node, parent) =>
    (parent as ESTree.UnaryExpression).operator !== "delete",
  VariableDeclarator: (_walk, node, parent) => {
    const declarator = parent as ESTree.VariableDeclarator;
    return declarator.init === node && declarator.id.type === "ObjectPattern";
  },
};

const staysInPlace: WalkPosition = (walk, node, parent) =>
  parent.type.startsWith("TS")
    ? parent.type !== "TSExportAssignment"
    : STAYS[parent.type]?.(walk, node, parent) === true;

const isPrefixOf = (keys: Chain["keys"], path: readonly string[]): boolean =>
  keys.length <= path.length &&
  keys.every((key, index) => key === undefined || key === path[index]);

const isCalled: Position = (node, parent) =>
  parent.type === "CallExpression" && parent.callee === node;

const touchesPath = (
  walk: classRootTypes.Walk,
  root: Root,
  chain: Chain,
  parent: flowTypes.Node,
): boolean =>
  !isCalled(chain.top, parent) &&
  isPrefixOf(chain.keys, root.path) &&
  !staysInPlace(walk, chain.top, parent);

const leavesChainAlone = (
  walk: classRootTypes.Walk,
  root: Root,
  chain: Chain,
  parent: flowTypes.Node,
): boolean =>
  WRITES[parent.type]?.(chain.top, parent) !== true && !touchesPath(walk, root, chain, parent);

const leavesPathAlone = (
  walk: classRootTypes.Walk,
  root: Root,
  identifier: flowTypes.Node,
): boolean => {
  const chain = climb(identifier, []);
  const parent = parentOf(chain.top);
  return parent === null || leavesChainAlone(walk, root, chain, parent);
};

const isUntouched = (walk: classRootTypes.Walk, root: Root): boolean =>
  root.references.every((identifier) => leavesPathAlone(walk, root, identifier));

const isExternalReference = (walk: classRootTypes.Walk, node: flowTypes.Node): boolean => {
  const root = rootOf(walk, node);
  return root !== undefined && isUntouched(walk, root);
};

const isFactoryReference = (walk: classRootTypes.Walk, node: flowTypes.Node): boolean => {
  const root = rootOf(walk, node);
  return root !== undefined && isFactoryKey(root.base, root.path) && isUntouched(walk, root);
};

const isTrustedCallee = (walk: classRootTypes.Walk, callee: flowTypes.Node): boolean => {
  const value = unwrap(callee);
  return value.type === "CallExpression"
    ? isTrustedCallee(walk, value.callee)
    : isFactoryReference(walk, value);
};

function isExternal(walk: classRootTypes.Walk, node: flowTypes.Node): boolean {
  const value = unwrap(node);
  return value.type === "CallExpression"
    ? isTrustedCallee(walk, value.callee)
    : isExternalReference(walk, value);
}

const declaredInPackage = (walk: classRootTypes.Walk, node: flowTypes.Node): boolean =>
  !isExternal(walk, node);

const classOrigin = { declaredInPackage };

export default classOrigin;
