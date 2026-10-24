import type { Context, ESTree } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";

type Node = flowTypes.Node;

type Root = classRootTypes.Root;

type Walk = classRootTypes.Walk;

const { TRANSPARENT, isFactoryCallee, isFactoryKey, parentOf, rootOf, staticKey, unwrap } =
  classRoot;

type Chain = { readonly top: Node; readonly keys: readonly (string | undefined)[] };

type Position = (node: Node, parent: Node) => boolean;

type WalkPosition = (walk: Walk, node: Node, parent: Node) => boolean;

const FUNCTIONS: ReadonlySet<Node["type"]> = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const PATTERNS: ReadonlySet<Node["type"]> = new Set([
  "ArrayPattern",
  "AssignmentPattern",
  "ObjectPattern",
  "RestElement",
]);

const climbsThrough = (parent: Node): boolean =>
  TRANSPARENT.has(parent.type) || parent.type === "ChainExpression";

const climbStep = (top: Node, parent: Node, keys: Chain["keys"]): Chain | undefined => {
  if (climbsThrough(parent)) return { keys, top: parent };
  return parent.type === "MemberExpression" && parent.object === top
    ? { keys: [...keys, staticKey(parent)], top: parent }
    : undefined;
};

const climb = (top: Node, keys: Chain["keys"]): Chain => {
  const parent = parentOf(top);
  const next = parent === null ? undefined : climbStep(top, parent, keys);
  return next === undefined ? { keys, top } : climb(next.top, next.keys);
};

const leftIs: Position = (node, parent) => (parent as { readonly left: Node }).left === node;

const inPattern: Position = (node, parent) => {
  const holder = parentOf(parent);
  return (
    holder !== null && PATTERNS.has(holder.type) && (parent as ESTree.ObjectProperty).value === node
  );
};

const WRITES: Readonly<Partial<Record<Node["type"], Position>>> = {
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

const climbOut = (node: Node): Node => {
  const parent = parentOf(node);
  return parent !== null && TRANSPARENT.has(parent.type) ? climbOut(parent) : node;
};

const isFactoryArgument = (walk: Walk, node: Node): boolean => {
  const argument = climbOut(node);
  const call = parentOf(argument);
  return (
    call?.type === "CallExpression" &&
    call.arguments.includes(argument as ESTree.Argument) &&
    isFactoryCallee(walk, call.callee)
  );
};

const enclosingFunction = (node: Node): Node | null => {
  const parent = parentOf(node);
  return parent === null || FUNCTIONS.has(parent.type) ? parent : enclosingFunction(parent);
};

const isFactoryArrow = (walk: Walk, fn: Node | null): boolean =>
  fn?.type === "ArrowFunctionExpression" && !fn.async && isFactoryArgument(walk, fn);

const STAYS: Readonly<Partial<Record<Node["type"], WalkPosition>>> = {
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

const passesReceiver = (root: Root, chain: Chain): boolean =>
  chain.keys.length > 0 &&
  isPrefixOf(chain.keys.slice(0, -1), root.path) &&
  !isFactoryKey(root.base, chain.keys);

const isCalled: Position = (node, parent) =>
  parent.type === "CallExpression" && parent.callee === node;

const touchesPath = (walk: Walk, root: Root, chain: Chain, parent: Node): boolean =>
  isCalled(chain.top, parent)
    ? passesReceiver(root, chain)
    : isPrefixOf(chain.keys, root.path) && !staysInPlace(walk, chain.top, parent);

const leavesChainAlone = (walk: Walk, root: Root, chain: Chain, parent: Node): boolean =>
  WRITES[parent.type]?.(chain.top, parent) !== true && !touchesPath(walk, root, chain, parent);

const leavesPathAlone = (walk: Walk, root: Root, identifier: Node): boolean => {
  const chain = climb(identifier, []);
  const parent = parentOf(chain.top);
  return parent === null || leavesChainAlone(walk, root, chain, parent);
};

const isUntouched = (walk: Walk, root: Root): boolean =>
  root.references.every((identifier) => leavesPathAlone(walk, root, identifier));

const isExternalReference = (walk: Walk, node: Node): boolean => {
  const root = rootOf(walk, node);
  return root !== undefined && isUntouched(walk, root);
};

const isFactoryReference = (walk: Walk, node: Node): boolean => {
  const root = rootOf(walk, node);
  return root !== undefined && isFactoryKey(root.base, root.path) && isUntouched(walk, root);
};

const isNode = (item: unknown): item is Node =>
  typeof item === "object" && item !== null && "type" in item;

const childrenOf = (context: Context, node: Node): readonly Node[] =>
  (context.sourceCode.visitorKeys[node.type] ?? []).flatMap((key) => {
    const child: unknown = (node as unknown as Readonly<Record<string, unknown>>)[key];
    return (Array.isArray(child) ? child : [child]).filter(isNode);
  });

const returnedValues = (context: Context, body: Node): readonly (Node | null)[] => {
  if (body.type === "ReturnStatement") return [body.argument];
  if (FUNCTIONS.has(body.type)) return [];
  return childrenOf(context, body).flatMap((child) => returnedValues(context, child));
};

const returnsExternal = (walk: Walk, arrow: ESTree.ArrowFunctionExpression): boolean => {
  if (arrow.body.type !== "BlockStatement") return isExternal(walk, arrow.body);
  return returnedValues(walk.context, arrow.body).every(
    (value) => value !== null && isExternal(walk, value),
  );
};

const isLiteral = (node: Node): boolean =>
  node.type === "Literal" || (node.type === "TemplateLiteral" && node.expressions.length === 0);

const isExternalArgument = (walk: Walk, argument: Node): boolean => {
  const value = unwrap(argument);
  if (isLiteral(value)) return true;
  return value.type === "ArrowFunctionExpression"
    ? returnsExternal(walk, value)
    : isExternalReference(walk, value);
};

const isTrustedCallee = (walk: Walk, callee: Node): boolean => {
  const value = unwrap(callee);
  return value.type === "CallExpression"
    ? isExternalCall(walk, value)
    : isFactoryReference(walk, value);
};

function isExternalCall(walk: Walk, call: ESTree.CallExpression): boolean {
  return (
    isTrustedCallee(walk, call.callee) &&
    call.arguments.every((argument) => isExternalArgument(walk, argument))
  );
}

function isExternal(walk: Walk, node: Node): boolean {
  const value = unwrap(node);
  return value.type === "CallExpression"
    ? isExternalCall(walk, value)
    : isExternalReference(walk, value);
}

const declaredInPackage = (
  context: Context,
  node: Node,
  selfSpecifiers: readonly string[],
): boolean => !isExternal({ context, selfSpecifiers }, node);

const classOrigin = { declaredInPackage };

export default classOrigin;
