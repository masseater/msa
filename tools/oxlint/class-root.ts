import type { Definition, ESTree } from "vite-plus/lint/plugins";

import classFactories from "./class-factories.ts";
import type classRootTypes from "./class-root.types.ts";
import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

type Root = classRootTypes.Root;

type Walk = classRootTypes.Walk;

const TRANSPARENT: ReadonlySet<Node["type"]> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const unwrap = (node: Node): Node =>
  TRANSPARENT.has(node.type) ? unwrap((node as { readonly expression: Node }).expression) : node;

const parentOf = (node: Node): Node | null => node.parent as Node | null;

const matchesSpecifier = (specifier: string, pattern: string): boolean => {
  const [prefix = "", suffix] = pattern.split("*");
  if (suffix === undefined) return specifier === pattern;
  return (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  );
};

const isPackageSpecifier = (walk: Walk, specifier: string): boolean =>
  !/^(?:[./#]|node:)/u.test(specifier) &&
  !walk.builtins.has(specifier.split("/")[0] ?? specifier) &&
  !walk.selfSpecifiers.some((pattern) => matchesSpecifier(specifier, pattern));

const importSource = (def: Definition): string | undefined =>
  def.type === "ImportBinding" && def.parent?.type === "ImportDeclaration"
    ? def.parent.source.value
    : undefined;

const isPackageImport = (walk: Walk, defs: readonly Definition[]): boolean => {
  const sources = defs.map(importSource);
  const [source] = sources;
  return sources.length === 1 && source !== undefined && isPackageSpecifier(walk, source);
};

const importedName = (specifier: ESTree.ImportDeclarationSpecifier): string | undefined => {
  if (specifier.type === "ImportNamespaceSpecifier") return undefined;
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  const { imported } = specifier;
  return imported.type === "Identifier" ? imported.name : imported.value;
};

const importBase = (def: Definition): string | undefined => {
  const source = importSource(def);
  if (source === undefined) return undefined;
  const name = importedName(def.node as ESTree.ImportDeclarationSpecifier);
  return name === undefined ? source : `${source}/${name}`;
};

const packageImportRoot = (walk: Walk, node: Node): Root | undefined => {
  const variable = scopeLookup.variableOf(walk.context, node);
  if (variable === undefined || !isPackageImport(walk, variable.defs)) return undefined;
  return {
    base: variable.defs[0] === undefined ? undefined : importBase(variable.defs[0]),
    path: [],
    references: variable.references.map((reference) => reference.identifier),
  };
};

const staticKey = (node: ESTree.MemberExpression): string | undefined => {
  if (!node.computed) return scopeLookup.staticMemberName(node);
  const { property } = node;
  return property.type === "Literal" && typeof property.value === "string"
    ? property.value
    : undefined;
};

const memberRoot = (walk: Walk, node: ESTree.MemberExpression): Root | undefined => {
  const key = staticKey(node);
  const root = key === undefined ? undefined : rootOf(walk, node.object);
  return root === undefined || key === undefined
    ? undefined
    : { ...root, path: [...root.path, key] };
};

const ROOTS: Readonly<Partial<Record<Node["type"], (walk: Walk, node: Node) => Root | undefined>>> =
  {
    Identifier: packageImportRoot,
    MemberExpression: (walk, node) => memberRoot(walk, node as ESTree.MemberExpression),
  };

function rootOf(walk: Walk, node: Node): Root | undefined {
  const value = unwrap(node);
  return ROOTS[value.type]?.(walk, value);
}

const factoryKey = (
  base: string | undefined,
  keys: readonly (string | undefined)[],
): string | undefined =>
  base === undefined || keys.some((key) => key === undefined)
    ? undefined
    : [base, ...keys].join("/");

const isFactoryKey = (base: string | undefined, keys: readonly (string | undefined)[]): boolean =>
  classFactories.has(factoryKey(base, keys) ?? "");

function isFactoryCallee(walk: Walk, callee: Node): boolean {
  const value = unwrap(callee);
  if (value.type === "CallExpression") return isFactoryCallee(walk, value.callee);
  const root = rootOf(walk, value);
  return root !== undefined && isFactoryKey(root.base, root.path);
}

const classRoot = {
  TRANSPARENT,
  isFactoryCallee,
  isFactoryKey,
  isPackageImport,
  parentOf,
  rootOf,
  staticKey,
  unwrap,
};

export default classRoot;
