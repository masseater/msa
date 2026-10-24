import type { ESTree, Variable } from "vite-plus/lint/plugins";

import classRoot from "./class-root.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";
import globalObject from "./global-object.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Walk = classRootTypes.Walk;

type Reporters = {
  readonly apiEscape: (node: Node) => void;
  readonly globalEscape: (node: Node) => void;
  readonly write: (node: Node) => void;
};

type Seen = ReadonlySet<Variable>;

const { isPackageImport, parentOf } = classRoot;

const {
  hasKeyIn,
  isAliasInit,
  isCalleeOf,
  isGlobalNamed,
  isGlobalObject,
  memberKey,
  staysGlobal,
  strip,
} = globalObject;

const SHARED_BUILTINS: ReadonlySet<string> = new Set(["Symbol"]);

const WRITE_APIS: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(["assign", "defineProperties", "defineProperty"]),
  Reflect: new Set(["defineProperty", "deleteProperty", "set"]),
};

const writeOf = (writeExpr: Node | null | undefined): readonly Node[] =>
  writeExpr === null || writeExpr === undefined ? [] : [writeExpr];

const writesOf = (variable: Variable): readonly Node[] =>
  variable.references.flatMap(({ writeExpr }) => writeOf(writeExpr));

const isSharedBinding = (walk: Walk, identifier: Node, seen: Seen): boolean => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  if (variable === undefined || seen.has(variable)) return false;
  if (isPackageImport(walk, variable.defs)) return true;
  const next = new Set([...seen, variable]);
  return writesOf(variable).some((write) => reachesShared(walk, write, next));
};

const isSharedRoot = (walk: Walk, value: Node): boolean =>
  isGlobalObject(walk, value) || isGlobalNamed(walk, value, SHARED_BUILTINS);

const SHARED_STEPS: Readonly<
  Partial<Record<Node["type"], (walk: Walk, node: Node, seen: Seen) => boolean>>
> = {
  Identifier: (walk, node, seen) => isSharedBinding(walk, node, seen),
  MemberExpression: (walk, node, seen) =>
    reachesShared(walk, (node as ESTree.MemberExpression).object, seen),
};

function reachesShared(walk: Walk, node: Node, seen: Seen): boolean {
  const value = strip(node);
  return isSharedRoot(walk, value) || SHARED_STEPS[value.type]?.(walk, value, seen) === true;
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

const API_BASES: ReadonlySet<string> = new Set(Object.keys(WRITE_APIS));

const apiBaseOfMember = (walk: Walk, member: Node): string | undefined =>
  hasKeyIn(API_BASES, member) && isGlobalObject(walk, (member as ESTree.MemberExpression).object)
    ? memberKey(member)
    : undefined;

const aliasedApiBase = (walk: Walk, identifier: Node, seen: Seen): string | undefined => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  if (variable === undefined || seen.has(variable)) return undefined;
  const next = new Set([...seen, variable]);
  return writesOf(variable)
    .map((write) => apiBaseOf(walk, write, next))
    .find((base) => base !== undefined);
};

const apiBaseOfIdentifier = (walk: Walk, identifier: Node, seen: Seen): string | undefined =>
  isGlobalNamed(walk, identifier, API_BASES)
    ? (identifier as ESTree.IdentifierReference).name
    : aliasedApiBase(walk, identifier, seen);

const API_BASE_STEPS: Readonly<
  Partial<Record<Node["type"], (walk: Walk, node: Node, seen: Seen) => string | undefined>>
> = {
  Identifier: apiBaseOfIdentifier,
  MemberExpression: (walk, node) => apiBaseOfMember(walk, node),
};

function apiBaseOf(walk: Walk, node: Node, seen: Seen): string | undefined {
  const value = strip(node);
  return API_BASE_STEPS[value.type]?.(walk, value, seen);
}

const isApiKey = (base: string | undefined, key: string | undefined): boolean =>
  base !== undefined && (key === undefined || WRITE_APIS[base]?.has(key) === true);

const literalKeyOf = (key: Node): string | undefined =>
  key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;

const propertyKeyOf = (property: ESTree.ObjectProperty): string | undefined =>
  !property.computed && property.key.type === "Identifier"
    ? property.key.name
    : literalKeyOf(property.key);

const patternKeyOf = (identifier: Node): string | undefined => {
  const property = parentOf(identifier);
  return property?.type === "Property" && property.value === identifier
    ? propertyKeyOf(property as ESTree.ObjectProperty)
    : undefined;
};

const isApiMember = (walk: Walk, node: Node, seen: Seen): boolean =>
  node.type === "MemberExpression" && isApiKey(apiBaseOf(walk, node.object, seen), memberKey(node));

const isDestructuredApi = (walk: Walk, identifier: Node, seen: Seen): boolean => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  if (variable === undefined || seen.has(variable)) return false;
  const next = new Set([...seen, variable]);
  return variable.references.some(({ identifier: written, writeExpr }) =>
    writeOf(writeExpr).some(
      (write) =>
        isApi(walk, write, next) ||
        (parentOf(written)?.type === "Property" &&
          isApiKey(apiBaseOf(walk, write, next), patternKeyOf(written))),
    ),
  );
};

function isApi(walk: Walk, node: Node, seen: Seen): boolean {
  const value = strip(node);
  return value.type === "Identifier"
    ? isDestructuredApi(walk, value, seen)
    : isApiMember(walk, value, seen);
}

const SYMBOL_FACTORY_KEYS: ReadonlySet<string> = new Set(["for"]);

const isSymbolFactory = (walk: Walk, callee: Node): boolean =>
  isGlobalNamed(walk, callee, SHARED_BUILTINS) ||
  (hasKeyIn(SYMBOL_FACTORY_KEYS, callee) &&
    isGlobalNamed(walk, strip((callee as ESTree.MemberExpression).object), SHARED_BUILTINS));

const isSymbolCall = (walk: Walk, node: Node): boolean =>
  node.type === "CallExpression" &&
  isSymbolFactory(walk, strip(node.callee)) &&
  node.arguments.every((argument) => argument.type === "Literal");

const isConstDefinition = (def: Variable["defs"][number] | undefined): boolean =>
  def?.parent?.type === "VariableDeclaration" && def.parent.kind === "const";

const constDeclarator = (variable: Variable): ESTree.VariableDeclarator | undefined => {
  const [def, ...rest] = variable.defs;
  return rest.length === 0 && isConstDefinition(def)
    ? (def?.node as ESTree.VariableDeclarator)
    : undefined;
};

const onlyWrite = (variable: Variable): Node | undefined => {
  const [write, ...rest] = writesOf(variable);
  return rest.length === 0 ? write : undefined;
};

const constInitOf = (variable: Variable): Node | undefined => {
  const declarator = constDeclarator(variable);
  const write = onlyWrite(variable);
  return declarator?.id.type === "Identifier" && write === declarator.init ? write : undefined;
};

const constInit = (walk: Walk, identifier: Node): Node | undefined => {
  const variable = scopeLookup.variableOf(walk.context, identifier);
  return variable === undefined ? undefined : constInitOf(variable);
};

const isSymbolKey = (walk: Walk, member: ESTree.MemberExpression): boolean => {
  if (!member.computed) return false;
  const key = strip(member.property);
  const value = key.type === "Identifier" ? constInit(walk, key) : key;
  return value !== undefined && isSymbolCall(walk, strip(value));
};

const createSharedWrite = (walk: Walk, report: Reporters) => {
  const checkTargets = (target: Node): void => {
    for (const member of targetsOf(target) as readonly ESTree.MemberExpression[])
      if (!isSymbolKey(walk, member) && reachesShared(walk, member.object, new Set()))
        report.write(member);
  };
  const isSharedTarget = (target: Node | undefined): boolean =>
    target !== undefined &&
    (target.type === "SpreadElement" || reachesShared(walk, target, new Set()));
  const checkCall = (node: ESTree.CallExpression): void => {
    if (isApi(walk, node.callee, new Set()) && isSharedTarget(node.arguments[0]))
      report.write(node);
  };
  const checkGlobalEscape = (node: Node): void => {
    if (!isGlobalObject(walk, node) || staysGlobal(walk, node)) return;
    report.globalEscape(node);
  };
  const checkApiEscape = (node: ESTree.MemberExpression): void => {
    if (isApiMember(walk, node, new Set()) && !isCalleeOf(node) && !isAliasInit(node))
      report.apiEscape(node);
  };
  return {
    AssignmentExpression: (node: ESTree.AssignmentExpression) => checkTargets(node.left),
    CallExpression: (node: ESTree.CallExpression) => {
      checkCall(node);
      checkGlobalEscape(node);
    },
    ForInStatement: (node: ESTree.ForInStatement) => checkTargets(node.left),
    ForOfStatement: (node: ESTree.ForOfStatement) => checkTargets(node.left),
    Identifier: (node: Node) => checkGlobalEscape(node),
    MemberExpression: (node: ESTree.MemberExpression) => {
      checkApiEscape(node);
      checkGlobalEscape(node);
    },
    NewExpression: (node: ESTree.NewExpression) => checkGlobalEscape(node),
    UnaryExpression: (node: ESTree.UnaryExpression) => {
      if (node.operator === "delete") checkTargets(node.argument);
    },
    UpdateExpression: (node: ESTree.UpdateExpression) => checkTargets(node.argument),
  };
};

const sharedWrite = { createSharedWrite };

export default sharedWrite;
