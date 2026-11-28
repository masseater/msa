import type { Context, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import type prototypeGuardTypes from "./prototype-guard.types.ts";
import scopeLookup from "./scope-lookup.ts";
import StaticString from "./static-string.ts";

const ACCESSOR_NAMES: ReadonlySet<string> = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const CODE_GLOBALS: ReadonlySet<string> = new Set(["Function", "ShadowRealm", "eval"]);
const REFLECTIVE_GLOBALS: ReadonlySet<string> = new Set(["Object", "Reflect"]);
const GLOBAL_HOLDERS: ReadonlySet<string> = new Set(["global", "globalThis", "self", "window"]);
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const TIMERS: ReadonlySet<string> = new Set(["setInterval", "setTimeout"]);
const KEYED: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["defineProperty", "getOwnPropertyDescriptor"]),
  Reflect: new Set(["defineProperty", "get", "getOwnPropertyDescriptor", "set"]),
};
const DESCRIPTOR_MAP: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["defineProperties"]),
  Reflect: new Set(),
};
const ALWAYS: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["create", "getOwnPropertyDescriptors"]),
  Reflect: new Set(),
};
const CODE_URL = /^(?:blob|data):/iu;

const MESSAGES = {
  accessor: "__defineGetter__ などで accessor を取り出さない",
  code: "文字列からコードを作らない（eval・Function・ShadowRealm・data: や blob: の import）",
  constructor: ".constructor を読まない。型の判定は instanceof か Predicate で行う",
  reflective:
    "Object・Reflect は Object.xxx(...) の形で直接呼ぶ。別名・分割代入・計算キーで取り出さない",
  write:
    "prototype・__proto__・constructor に届く書き込みをしない。キーは literal で書き、Object.assign の元は literal の object にする",
} as const;

type Kind = keyof typeof MESSAGES;

const isSafeText = (text: string | undefined): boolean =>
  text !== undefined && !UNSAFE_KEYS.has(text);

const isSafeKey = (guard: prototypeGuardTypes.Guard, node: flowTypes.Node | undefined): boolean =>
  node !== undefined && node.type !== "SpreadElement" && isSafeText(guard.strings.fold(node));

const keyText = (
  guard: prototypeGuardTypes.Guard,
  property: ESTree.ObjectProperty,
): string | undefined => {
  const key = property.key as flowTypes.Node;
  if (property.computed) return guard.strings.fold(key);
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" ? String(key.value) : undefined;
};

const isSafeObject = (
  guard: prototypeGuardTypes.Guard,
  node: flowTypes.Node | undefined,
): boolean =>
  node?.type === "ObjectExpression" &&
  node.properties.every(
    (property) => property.type === "Property" && isSafeText(keyText(guard, property)),
  );

const memberKey = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.MemberExpression,
): string | undefined =>
  node.computed
    ? guard.strings.fold(node.property as flowTypes.Node)
    : scopeLookup.staticMemberName(node);

const ownerOf = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.MemberExpression,
): string | undefined =>
  scopeLookup.isGlobalNamed(guard.context, node.object as flowTypes.Node, REFLECTIVE_GLOBALS)
    ? (node.object as ESTree.IdentifierReference).name
    : undefined;

const callOf = (node: flowTypes.Node): ESTree.CallExpression | undefined => {
  const parent = node.parent as flowTypes.Node | null;
  return parent?.type === "CallExpression" && parent.callee === node ? parent : undefined;
};

const isAssign = (owner: string, name: string): boolean => owner === "Object" && name === "assign";

type ArgumentCheck = (
  guard: prototypeGuardTypes.Guard,
  args: readonly (flowTypes.Node | undefined)[],
) => boolean;

const UNSAFE_ARGUMENTS: Readonly<Record<"assign" | "described" | "keyed", ArgumentCheck>> = {
  assign: (guard, [, ...sources]) => !sources.every((source) => isSafeObject(guard, source)),
  described: (guard, [, descriptors]) => !isSafeObject(guard, descriptors),
  keyed: (guard, [, key]) => !isSafeKey(guard, key),
};

const API_KINDS = [
  ["always", ALWAYS],
  ["keyed", KEYED],
  ["described", DESCRIPTOR_MAP],
] as const;

const apiKind = (owner: string, name: string) =>
  API_KINDS.find(([, table]) => table[owner]!.has(name))?.[0] ??
  (isAssign(owner, name) ? "assign" : undefined);

const writesThroughApi = (
  guard: prototypeGuardTypes.Guard,
  owner: string,
  name: string,
  node: flowTypes.Node,
): boolean => {
  const kind = apiKind(owner, name);
  if (kind === undefined) return false;
  const call = callOf(node);
  return (
    kind === "always" ||
    call === undefined ||
    UNSAFE_ARGUMENTS[kind](guard, call.arguments as readonly flowTypes.Node[])
  );
};

const checkReflectiveMember = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.MemberExpression,
  owner: string,
): void => {
  const name = memberKey(guard, node);
  if (name === undefined || node.computed) return guard.report("reflective", node);
  if (writesThroughApi(guard, owner, name, node)) guard.report("write", node);
  return undefined;
};

const isMemberObject = (node: flowTypes.Node): boolean => {
  const parent = node.parent as flowTypes.Node | null;
  return parent?.type === "MemberExpression" && parent.object === node;
};

const checkGlobalIdentifier = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.IdentifierReference,
): void => {
  if (CODE_GLOBALS.has(node.name)) guard.report("code", node);
  if (REFLECTIVE_GLOBALS.has(node.name) && !isMemberObject(node)) guard.report("reflective", node);
};

const checkIdentifier = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.IdentifierReference,
): void => {
  if (ACCESSOR_NAMES.has(node.name)) guard.report("accessor", node);
  if (guard.context.sourceCode.isGlobalReference(node)) checkGlobalIdentifier(guard, node);
};

const checkString = (guard: prototypeGuardTypes.Guard, node: flowTypes.Node): void => {
  const text = guard.strings.fold(node);
  if (text !== undefined && ACCESSOR_NAMES.has(text)) guard.report("accessor", node);
};

const holderKind = (name: string | undefined): Kind | undefined => {
  if (name === undefined || REFLECTIVE_GLOBALS.has(name)) return "reflective";
  return CODE_GLOBALS.has(name) ? "code" : undefined;
};

const checkGlobalHolder = (
  guard: prototypeGuardTypes.Guard,
  node: ESTree.MemberExpression,
  name?: string,
): void => {
  if (!scopeLookup.isGlobalNamed(guard.context, node.object as flowTypes.Node, GLOBAL_HOLDERS))
    return;
  const kind = holderKind(name);
  if (kind !== undefined) guard.report(kind, node);
};

const checkMember = (guard: prototypeGuardTypes.Guard, node: ESTree.MemberExpression): void => {
  const owner = ownerOf(guard, node);
  if (owner !== undefined) checkReflectiveMember(guard, node, owner);
  const name = memberKey(guard, node);
  if (name === "constructor") guard.report("constructor", node);
  checkGlobalHolder(guard, node, name);
};

const writesUnsafeMember = (guard: prototypeGuardTypes.Guard, target: flowTypes.Node): boolean => {
  const value = target.type === "ChainExpression" ? (target.expression as flowTypes.Node) : target;
  if (value.type !== "MemberExpression") return false;
  const name = memberKey(guard, value);
  return name !== undefined && UNSAFE_KEYS.has(name);
};

const PATTERN_TARGETS: Readonly<
  Partial<Record<flowTypes.Node["type"], (node: flowTypes.Node) => readonly flowTypes.Node[]>>
> = {
  ArrayPattern: (node) =>
    (node as ESTree.ArrayPattern).elements.flatMap((element) =>
      element === null ? [] : targetsOf(element as flowTypes.Node),
    ),
  AssignmentPattern: (node) => targetsOf((node as ESTree.AssignmentPattern).left as flowTypes.Node),
  ObjectPattern: (node) =>
    (node as ESTree.ObjectPattern).properties.flatMap((property) =>
      targetsOf(
        (property.type === "RestElement" ? property.argument : property.value) as flowTypes.Node,
      ),
    ),
  RestElement: (node) => targetsOf((node as { readonly argument: flowTypes.Node }).argument),
};

function targetsOf(node: flowTypes.Node): readonly flowTypes.Node[] {
  return PATTERN_TARGETS[node.type]?.(node) ?? [node];
}

const checkWrite = (guard: prototypeGuardTypes.Guard, target: flowTypes.Node): void => {
  for (const member of targetsOf(target))
    if (writesUnsafeMember(guard, member)) guard.report("write", member);
};

const isCodeUrl = (guard: prototypeGuardTypes.Guard, node: flowTypes.Node | undefined): boolean => {
  const text = node === undefined ? undefined : guard.strings.fold(node);
  return text !== undefined && CODE_URL.test(text);
};

const hasEvalOption = (
  guard: prototypeGuardTypes.Guard,
  node: flowTypes.Node | undefined,
): boolean =>
  node?.type === "ObjectExpression" &&
  node.properties.some(
    (property) => property.type === "Property" && keyText(guard, property) === "eval",
  );

type Called = ESTree.CallExpression | ESTree.NewExpression;

const isWorker = (node: Called): boolean =>
  node.callee.type === "Identifier" && node.callee.name === "Worker";

const checkWorker = (
  guard: prototypeGuardTypes.Guard,
  node: Called,
  first?: flowTypes.Node,
  second?: flowTypes.Node,
): void => {
  if (!isWorker(node)) return;
  if (isCodeUrl(guard, first)) guard.report("code", node);
  if (hasEvalOption(guard, second)) guard.report("code", second!);
};

const isStringTimer = (
  guard: prototypeGuardTypes.Guard,
  node: Called,
  first: flowTypes.Node | undefined,
): boolean =>
  first !== undefined &&
  scopeLookup.isGlobalNamed(guard.context, node.callee as flowTypes.Node, TIMERS) &&
  guard.strings.fold(first) !== undefined;

const checkCall = (guard: prototypeGuardTypes.Guard, node: Called): void => {
  const [first, second] = node.arguments as readonly (flowTypes.Node | undefined)[];
  checkWorker(guard, node, first, second);
  if (isStringTimer(guard, node, first)) guard.report("code", node);
};

const createPrototypeGuard = (context: Context, report: prototypeGuardTypes.Guard["report"]) => {
  const guard: prototypeGuardTypes.Guard = { context, report, strings: new StaticString(context) };
  return {
    AssignmentExpression: (node: ESTree.AssignmentExpression) =>
      checkWrite(guard, node.left as flowTypes.Node),
    CallExpression: (node: ESTree.CallExpression) => checkCall(guard, node),
    ForInStatement: (node: ESTree.ForInStatement) => checkWrite(guard, node.left as flowTypes.Node),
    ForOfStatement: (node: ESTree.ForOfStatement) => checkWrite(guard, node.left as flowTypes.Node),
    Identifier: (node: ESTree.IdentifierReference) => checkIdentifier(guard, node),
    ImportExpression: (node: ESTree.ImportExpression) => {
      if (isCodeUrl(guard, node.source as flowTypes.Node)) report("code", node);
    },
    Literal: (node: flowTypes.Node) => checkString(guard, node),
    MemberExpression: (node: ESTree.MemberExpression) => checkMember(guard, node),
    NewExpression: (node: ESTree.NewExpression) => checkCall(guard, node),
    TemplateLiteral: (node: flowTypes.Node) => checkString(guard, node),
    UnaryExpression: (node: ESTree.UnaryExpression) => {
      if (node.operator === "delete") checkWrite(guard, node.argument as flowTypes.Node);
    },
    UpdateExpression: (node: ESTree.UpdateExpression) =>
      checkWrite(guard, node.argument as flowTypes.Node),
  };
};

const prototypeGuard = { MESSAGES, createPrototypeGuard };

export default prototypeGuard;
