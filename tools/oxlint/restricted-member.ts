import type { Context, ESTree, Variable } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type RestrictedMember = {
  readonly message: string;
  readonly module: string;
  readonly path: readonly string[];
};

type Walk = {
  readonly context: Context;
  readonly report: (node: Node) => void;
  readonly visited: Set<Variable>;
};

type Step = (walk: Walk, node: Node, path: readonly string[]) => void;

type ParentStep = (walk: Walk, node: Node, parent: Node, path: readonly string[]) => void;

type ImportSpecifier = ESTree.ImportDeclaration["specifiers"][number];

const literalName = (node: Node): string | undefined =>
  node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;

const memberName = (node: ESTree.MemberExpression): string | undefined =>
  node.computed ? literalName(node.property) : scopeLookup.staticMemberName(node);

const keyName = (property: ESTree.BindingProperty): string | undefined =>
  !property.computed && property.key.type === "Identifier" ? property.key.name : undefined;

function followVariable(walk: Walk, variable: Variable | undefined, path: readonly string[]) {
  if (variable === undefined || walk.visited.has(variable)) return;
  walk.visited.add(variable);
  for (const reference of variable.references) followNode(walk, reference.identifier, path);
}

function followProperty(
  walk: Walk,
  property: ESTree.ObjectPattern["properties"][number],
  path: readonly string[],
) {
  if (property.type !== "Property" || keyName(property) !== path[0]) return;
  if (path.length === 1) walk.report(property);
  else followBinding(walk, property.value, path.slice(1));
}

const BINDINGS: Readonly<Partial<Record<Node["type"], Step>>> = {
  Identifier: (walk, id, path) =>
    followVariable(walk, scopeLookup.variableOf(walk.context, id), path),
  ObjectPattern: (walk, id, path) => {
    for (const property of (id as ESTree.ObjectPattern).properties)
      followProperty(walk, property, path);
  },
};

function followBinding(walk: Walk, id: Node, path: readonly string[]) {
  BINDINGS[id.type]?.(walk, id, path);
}

const PARENTS: Readonly<Partial<Record<Node["type"], ParentStep>>> = {
  MemberExpression: (walk, node, parent, path) => {
    const member = parent as ESTree.MemberExpression;
    if (member.object === node && memberName(member) === path[0])
      followNode(walk, member, path.slice(1));
  },
  VariableDeclarator: (walk, node, parent, path) => {
    const declarator = parent as ESTree.VariableDeclarator;
    if (declarator.init === node) followBinding(walk, declarator.id, path);
  },
};

function followNode(walk: Walk, node: Node, path: readonly string[]) {
  if (path.length === 0) {
    walk.report(node);
    return;
  }
  const { parent } = node;
  if (parent !== null) PARENTS[parent.type]?.(walk, node, parent, path);
}

const importedName = (specifier: ESTree.ImportSpecifier): string =>
  specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;

const pathAfterImport = (
  specifier: ImportSpecifier,
  path: readonly string[],
): readonly string[] | undefined => {
  if (specifier.type === "ImportNamespaceSpecifier") return path;
  if (specifier.type === "ImportSpecifier" && importedName(specifier) === path[0])
    return path.slice(1);
  return undefined;
};

const checkSpecifier = (walk: Walk, specifier: ImportSpecifier, member: RestrictedMember) => {
  const path = pathAfterImport(specifier, member.path);
  if (path === undefined) return;
  if (path.length === 0) {
    walk.report(specifier);
    return;
  }
  for (const variable of walk.context.sourceCode.getDeclaredVariables(specifier))
    followVariable(walk, variable, path);
};

const checkImport = (
  context: Context,
  node: ESTree.ImportDeclaration,
  member: RestrictedMember,
): void => {
  if (node.source.value !== member.module) return;
  const walk: Walk = {
    context,
    report: (target) => context.report({ message: member.message, node: target }),
    visited: new Set(),
  };
  for (const specifier of node.specifiers) checkSpecifier(walk, specifier, member);
};

const restrictedMembersOf = (context: Context): readonly RestrictedMember[] => {
  const [options] = context.options as readonly ({ members?: RestrictedMember[] } | undefined)[];
  return options?.members ?? [];
};

const restrictedMember = { checkImport, restrictedMembersOf };

export default restrictedMember;
