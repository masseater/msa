import type { Context, Reference, Scope, Variable } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";

const findVariable = (scope: Scope | null, name: string): Variable | undefined => {
  let current = scope;
  while (current !== null) {
    const variable = current.set.get(name);
    if (variable !== undefined) return variable;
    current = current.upper;
  }
  return undefined;
};

const variableOf = (context: Context, identifier: flowTypes.Node): Variable | undefined =>
  identifier.type === "Identifier"
    ? findVariable(context.sourceCode.getScope(identifier), identifier.name)
    : undefined;

const declaredReferences = (scope: Scope | null, name: string): readonly Reference[] =>
  scope?.set.get(name)?.references ?? [];

const implicitReferences = (scope: Scope | null, name: string): readonly Reference[] =>
  (scope?.through ?? []).filter((reference) => reference.identifier.name === name);

const globalReferences = (context: Context, name: string): readonly flowTypes.Node[] => {
  const scope = context.sourceCode.scopeManager.globalScope;
  const references = [...declaredReferences(scope, name), ...implicitReferences(scope, name)];
  return [...new Set(references.map((reference) => reference.identifier))];
};

const isGlobalNamed = (
  context: Context,
  node: flowTypes.Node,
  names: ReadonlySet<string>,
): boolean =>
  node.type === "Identifier" && names.has(node.name) && context.sourceCode.isGlobalReference(node);

const propertyName = (property: flowTypes.Node): string | undefined =>
  property.type === "Identifier" ? property.name : undefined;

const staticMemberName = (node: flowTypes.Node): string | undefined =>
  node.type === "MemberExpression" && !node.computed ? propertyName(node.property) : undefined;

const scopeLookup = { globalReferences, isGlobalNamed, staticMemberName, variableOf };

export default scopeLookup;
