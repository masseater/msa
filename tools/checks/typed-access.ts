import { NodeFlags, SyntaxKind } from "typescript/unstable/ast";
import type {
  Expression,
  HeritageClause,
  Node,
  ShorthandPropertyAssignment,
  SourceFile,
  VariableDeclaration,
} from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isComputedPropertyName,
  isElementAccessExpression,
  isExportAssignment,
  isForInStatement,
  isForOfStatement,
  isHeritageClause,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Project, Symbol as TsSymbol } from "typescript/unstable/sync";

import lintConfig from "../../lint.config.ts";
import processEnvWrite from "./process-env-write.ts";
import typedKey from "./typed-key.ts";
import typedProject from "./typed-project.ts";

const { processEnvWriter } = lintConfig;
const { descendants, locate, scanProject } = typedProject;

type Finding = {
  readonly detail: string;
  readonly file: string;
  readonly line: number;
  readonly rule: "computed-key" | "extends-holder";
  readonly text: string;
};

type Scope = { readonly files: (name: string) => boolean; readonly root: string };

const TRANSPARENT: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.AsExpression,
  SyntaxKind.NonNullExpression,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.SatisfiesExpression,
  SyntaxKind.TypeAssertionExpression,
]);

const LITERAL_KEYS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.NumericLiteral,
  SyntaxKind.StringLiteral,
]);

const strip = (node: Node): Node =>
  TRANSPARENT.has(node.kind) ? strip((node as unknown as { expression: Node }).expression) : node;

function assignedBy(node: Node, parent: Node): boolean {
  return (
    isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === SyntaxKind.EqualsToken
  );
}

function iteratedBy(node: Node, parent: Node): boolean {
  return (isForOfStatement(parent) || isForInStatement(parent)) && parent.initializer === node;
}

function isNestedPattern(node: Node, parent: Node): boolean {
  return (
    isArrayLiteralExpression(parent) ||
    isSpreadAssignment(parent) ||
    (isPropertyAssignment(parent) && parent.initializer === node)
  );
}

function patternOwnerOf(parent: Node): Node | undefined {
  return isArrayLiteralExpression(parent) ? parent : parent.parent;
}

function nestedTarget(node: Node, parent: Node): boolean {
  if (TRANSPARENT.has(parent.kind)) return isAssignmentTarget(parent);
  if (!isNestedPattern(node, parent)) return false;
  const owner = patternOwnerOf(parent);
  return owner !== undefined && isAssignmentTarget(owner);
}

function isAssignmentTarget(node: Node): boolean {
  const { parent } = node;
  if (parent === undefined) return false;
  return assignedBy(node, parent) || iteratedBy(node, parent) || nestedTarget(node, parent);
}

const objectPatternOf = (parent: Node | undefined): Node | undefined =>
  parent !== undefined && isPropertyAssignment(parent) ? parent.parent : undefined;

const isDestructuredProperty = (parent: Node | undefined): boolean => {
  const object = objectPatternOf(parent);
  return object !== undefined && isObjectLiteralExpression(object) && isAssignmentTarget(object);
};

const isPatternKey = (parent: Node | undefined): boolean =>
  (parent !== undefined && isBindingElement(parent)) || isDestructuredProperty(parent);

const computedPatternKey = (node: Node): Expression | undefined =>
  isComputedPropertyName(node) && isPatternKey(node.parent) ? node.expression : undefined;

const computedKey = (node: Node): Expression | undefined => {
  if (!isElementAccessExpression(node)) return computedPatternKey(node);
  return LITERAL_KEYS.has(strip(node.argumentExpression).kind)
    ? undefined
    : node.argumentExpression;
};

const isObjectIdentifier = (node: Node): boolean => isIdentifier(node) && node.text === "Object";

const isObjectFreeze = (callee: Node): boolean =>
  isPropertyAccessExpression(callee) &&
  isObjectIdentifier(callee.expression) &&
  callee.name.text === "freeze";

const isFreezeCall = (node: Node): boolean => {
  const value = strip(node);
  return isCallExpression(value) && isObjectFreeze(strip(value.expression));
};

const resolveAlias = (checker: Checker, symbol: TsSymbol): TsSymbol =>
  (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);

const isConstDeclaration = (node: Node): boolean =>
  node.parent !== undefined && (node.parent.flags & NodeFlags.Const) !== 0;

function valueProblem(project: Project, value: Node): string | undefined {
  if (isFreezeCall(value)) return undefined;
  const stripped = strip(value);
  return isIdentifier(stripped) || isPropertyAccessExpression(stripped)
    ? holderProblem(project, stripped)
    : "is not Object.freeze(...)";
}

function variableProblem(
  project: Project,
  declaration: VariableDeclaration,
  name: string,
): string | undefined {
  return isConstDeclaration(declaration) && declaration.initializer !== undefined
    ? valueProblem(project, declaration.initializer)
    : `${name} is not a const`;
}

function assignedValue(declaration: Node): Node | undefined {
  if (isExportAssignment(declaration)) return declaration.expression;
  return isPropertyAssignment(declaration) ? declaration.initializer : undefined;
}

function shorthandProblem(
  project: Project,
  declaration: ShorthandPropertyAssignment,
): string | undefined {
  const target = project.checker.getShorthandAssignmentValueSymbol(declaration);
  return target === undefined ? "unresolved shorthand" : symbolProblem(project, target);
}

function declaredProblem(project: Project, declaration: Node, name: string): string | undefined {
  if (isVariableDeclaration(declaration)) return variableProblem(project, declaration, name);
  const value = assignedValue(declaration);
  if (value !== undefined) return valueProblem(project, value);
  return isShorthandPropertyAssignment(declaration)
    ? shorthandProblem(project, declaration)
    : `${name} is declared by ${SyntaxKind[declaration.kind]}`;
}

function declarationProblem(project: Project, symbol: TsSymbol): string | undefined {
  const declared = symbol.valueDeclaration ?? symbol.declarations[0];
  const declaration = declared?.resolve(project);
  return declaration === undefined
    ? `${symbol.name} has no value declaration`
    : declaredProblem(project, declaration, symbol.name);
}

function symbolProblem(project: Project, symbol: TsSymbol): string | undefined {
  const target = resolveAlias(project.checker, symbol);
  return (target.flags & SymbolFlags.Module) === 0
    ? declarationProblem(project, target)
    : undefined;
}

function holderProblem(project: Project, node: Node): string | undefined {
  const symbol = project.checker.getSymbolAtLocation(node);
  return symbol === undefined ? "unresolved" : symbolProblem(project, symbol);
}

const baseOf = (expression: Node): Node => {
  const value = strip(expression);
  return isCallExpression(value) ? baseOf(value.expression) : value;
};

const containersOf = (path: Node): readonly Node[] | undefined => {
  const value = strip(path);
  if (isIdentifier(value)) return [];
  if (!isPropertyAccessExpression(value)) return undefined;
  const inner = containersOf(value.expression);
  return inner === undefined ? undefined : [...inner, strip(value.expression)];
};

const isClassExtends = (node: Node): node is HeritageClause =>
  isHeritageClause(node) &&
  node.token === SyntaxKind.ExtendsKeyword &&
  node.parent?.kind !== SyntaxKind.InterfaceDeclaration;

const extendedExpressions = (node: Node): readonly Node[] =>
  isClassExtends(node) ? node.types.map((type) => type.expression) : [];

const holderFindings = (project: Project, extended: Node) => {
  const containers = containersOf(baseOf(extended));
  if (containers === undefined) return [{ detail: "not a static path", node: extended }];
  return containers.flatMap((container) => {
    const problem = holderProblem(project, container);
    return problem === undefined ? [] : [{ detail: problem, node: container }];
  });
};

const keyFindings = (project: Project, keys: readonly Node[]) => {
  const types = keys.length === 0 ? [] : project.checker.getTypeAtLocation(keys);
  return keys.flatMap((key, index) => {
    const problem = typedKey.keyProblem(project.checker, types[index]);
    return problem === undefined ? [] : [{ detail: problem, node: key.parent! }];
  });
};

const scanFile = (project: Project, file: SourceFile, relative: string): readonly Finding[] => {
  const nodes = descendants(file);
  const keys = nodes
    .flatMap((node) => computedKey(node) ?? [])
    .filter(
      (key) => relative !== processEnvWriter || !processEnvWrite.isSanctionedAccess(key.parent!),
    );
  const at = (rule: Finding["rule"]) => (found: { detail: string; node: Node }) => ({
    ...locate(file, found.node),
    detail: found.detail,
    file: relative,
    rule,
  });
  return [
    ...keyFindings(project, keys).map(at("computed-key")),
    ...nodes
      .flatMap(extendedExpressions)
      .flatMap((extended) => holderFindings(project, extended))
      .map(at("extends-holder")),
  ];
};

const scan = (scope: Scope): readonly Finding[] => scanProject(scope, scanFile);

const typedAccess = { scan };

export default typedAccess;
