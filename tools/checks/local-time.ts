import { SyntaxKind } from "typescript/unstable/ast";
import type {
  BinaryExpression,
  BindingElement,
  CallExpression,
  Node,
  SourceFile,
} from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTemplateSpan,
} from "typescript/unstable/ast/is";
import { SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Project, Symbol as TsSymbol, Type } from "typescript/unstable/sync";

import typedProject from "./typed-project.ts";

type Finding = {
  readonly detail: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

type Scope = { readonly files: (name: string) => boolean; readonly root: string };

type Hit = { readonly detail: string; readonly node: Node };

const { descendants, locate, scanProject } = typedProject;

type ReferenceRule = (symbol: TsSymbol, node: Node) => Hit | undefined;

const OWNERS: ReadonlySet<string> = new Set([
  "libs/chord/src/local-time.ts",
  "apps/coding-agent/src/utils/zip.ts",
]);

const DATE_MEMBERS: ReadonlySet<string> = new Set([
  "getDate",
  "getDay",
  "getFullYear",
  "getHours",
  "getMilliseconds",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "getYear",
  "toDateString",
  "toLocaleDateString",
  "toLocaleString",
  "toLocaleTimeString",
  "toString",
  "toTimeString",
]);

const LIB_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Date", DATE_MEMBERS],
  ["Intl", new Set(["DateTimeFormat"])],
]);

const EFFECT_LOCAL: ReadonlySet<string> = new Set([
  "formatLocal",
  "layerCurrentZoneLocal",
  "withCurrentZoneLocal",
  "zoneMakeLocal",
]);

const EFFECT_ZONED_MAKERS: ReadonlySet<string> = new Set(["makeZoned", "makeZonedUnsafe"]);

const WATCHED: ReadonlySet<string> = new Set([
  ...DATE_MEMBERS,
  ...EFFECT_LOCAL,
  ...EFFECT_ZONED_MAKERS,
  "Date",
  "DateTimeFormat",
]);

const SPECIFIERS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ExportSpecifier,
  SyntaxKind.ImportSpecifier,
]);

const declaredIn = (symbol: TsSymbol, file: RegExp): boolean =>
  symbol.declarations.some(({ path }) => file.test(path));

const isDefaultLib = (symbol: TsSymbol): boolean => declaredIn(symbol, /\/lib\.[\w.]+\.d\.ts$/iu);

const isEffectDateTime = (symbol: TsSymbol): boolean =>
  declaredIn(symbol, /\/effect\/(?:dist|src)\/datetime\.(?:d\.)?ts$/iu);

const resolveAlias = (checker: Checker, symbol: TsSymbol): TsSymbol =>
  (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);

const effectProblem = (symbol: TsSymbol): string | undefined =>
  EFFECT_LOCAL.has(symbol.name) ? `DateTime.${symbol.name} は端末のタイムゾーンを読む` : undefined;

const libProblem = (symbol: TsSymbol): string | undefined => {
  const owner = symbol.getParent()?.name ?? "";
  return LIB_MEMBERS.get(owner)?.has(symbol.name) === true
    ? `${owner}.${symbol.name} は端末のタイムゾーンで読み書きする`
    : undefined;
};

const symbolProblem = (symbol: TsSymbol): string | undefined => {
  if (isEffectDateTime(symbol)) return effectProblem(symbol);
  return isDefaultLib(symbol) ? libProblem(symbol) : undefined;
};

const nameText = (node: Node): string | undefined =>
  isIdentifier(node) || isStringLiteral(node) ? node.text : undefined;

const isElementKey = (node: Node): boolean =>
  node.parent !== undefined &&
  isElementAccessExpression(node.parent) &&
  node.parent.argumentExpression === node;

const isNamedReference = (node: Node): boolean =>
  WATCHED.has(nameText(node) ?? "") && (isIdentifier(node) || isElementKey(node));

const callWith = (callee: Node): CallExpression | undefined => {
  const { parent } = callee;
  return parent !== undefined && isCallExpression(parent) && parent.expression === callee
    ? parent
    : undefined;
};

const isMemberName = (node: Node): boolean =>
  node.parent !== undefined && isPropertyAccessExpression(node.parent) && node.parent.name === node;

const callOf = (node: Node): CallExpression | undefined =>
  callWith(isMemberName(node) ? node.parent! : node);

const isTimeZoneProperty = (property: Node): boolean =>
  (isPropertyAssignment(property) || isShorthandPropertyAssignment(property)) &&
  nameText(property.name) === "timeZone";

const hasTimeZoneOption = (node: Node | undefined): boolean =>
  node !== undefined && isObjectLiteralExpression(node) && node.properties.some(isTimeZoneProperty);

const isZonedMaker = (symbol: TsSymbol): boolean =>
  EFFECT_ZONED_MAKERS.has(symbol.name) && isEffectDateTime(symbol);

const isSpecifier = (node: Node): boolean =>
  SPECIFIERS.has(node.parent?.kind ?? SyntaxKind.Unknown);

const isBareDateCall = (symbol: TsSymbol, node: Node): boolean =>
  symbol.name === "Date" && isDefaultLib(symbol) && callWith(node) !== undefined;

const REFERENCE_RULES: readonly ReferenceRule[] = [
  (symbol, node) => {
    const detail = symbolProblem(symbol);
    return detail === undefined ? undefined : { detail, node };
  },
  (symbol, node) =>
    isBareDateCall(symbol, node)
      ? { detail: "new なしの Date() は端末のタイムゾーンで書いた文字列を返す", node: node.parent! }
      : undefined,
  (symbol, node) =>
    isZonedMaker(symbol) && !isSpecifier(node) && !hasTimeZoneOption(callOf(node)?.arguments[1])
      ? { detail: `timeZone のない DateTime.${symbol.name} は端末のタイムゾーンを付ける`, node }
      : undefined,
];

const referenceHits = (symbol: TsSymbol, node: Node): readonly Hit[] =>
  REFERENCE_RULES.flatMap((rule) => rule(symbol, node) ?? []);

function namedHits({ checker }: Project, nodes: readonly Node[]): readonly Hit[] {
  const references = nodes.filter(isNamedReference);
  const symbols = references.length === 0 ? [] : checker.getSymbolAtLocation(references);
  return references.flatMap((node, index) => {
    const found = symbols[index];
    return found === undefined ? [] : referenceHits(resolveAlias(checker, found), node);
  });
}

const isObjectBindingElement = (node: Node): node is BindingElement =>
  isBindingElement(node) && node.parent !== undefined && isObjectBindingPattern(node.parent);

const bindingKey = (element: BindingElement): string | undefined => {
  const key = element.propertyName ?? element.name;
  return key === undefined ? undefined : nameText(key);
};

const isWatchedBinding = (node: Node): node is BindingElement =>
  isObjectBindingElement(node) && WATCHED.has(bindingKey(node) ?? "");

const memberProblem = (checker: Checker, source: Type, key: string | undefined) => {
  const member = checker.getPropertiesOfType(source).find(({ name }) => name === key);
  return member === undefined ? undefined : symbolProblem(resolveAlias(checker, member));
};

function bindingHits({ checker }: Project, nodes: readonly Node[]): readonly Hit[] {
  const bindings = nodes.filter(isWatchedBinding);
  const sources = typesOf(
    checker,
    bindings.map((node) => node.parent!),
  );
  return bindings.flatMap((node, index) => {
    const source = sources[index];
    const detail =
      source === undefined ? undefined : memberProblem(checker, source, bindingKey(node));
    return detail === undefined ? [] : [{ detail, node }];
  });
}

const isStringConcat = (node: Node): node is BinaryExpression =>
  isBinaryExpression(node) &&
  [SyntaxKind.PlusToken, SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind);

const isIdentifierNamed = (node: Node, name: string): boolean =>
  isIdentifier(node) && node.text === name;

const isReflectCall = (call: CallExpression): boolean =>
  isPropertyAccessExpression(call.expression) &&
  isIdentifierNamed(call.expression.expression, "Reflect");

const isStringifyingCall = (node: Node): node is CallExpression =>
  isCallExpression(node) && (isIdentifierNamed(node.expression, "String") || isReflectCall(node));

const OPERANDS: readonly ((node: Node) => readonly Node[])[] = [
  (node) => (isTemplateSpan(node) ? [node.expression] : []),
  (node) => (isStringConcat(node) ? [node.left, node.right] : []),
  (node) => (isStringifyingCall(node) ? [...node.arguments] : []),
  (node) => (isElementAccessExpression(node) ? [node.expression] : []),
];

const stringifiedOperands = (node: Node): readonly Node[] =>
  OPERANDS.flatMap((operands) => operands(node));

const typeOf = (checker: Checker, node: Node): Type | undefined => {
  try {
    return checker.getTypeAtLocation(node);
  } catch {
    return undefined;
  }
};

const typesOf = (checker: Checker, nodes: readonly Node[]): readonly (Type | undefined)[] => {
  if (nodes.length === 0) return [];
  try {
    return checker.getTypeAtLocation(nodes);
  } catch {
    return nodes.map((node) => typeOf(checker, node));
  }
};

const isDateType = (checker: Checker, type: Type | undefined): boolean =>
  type !== undefined && checker.typeToString(type) === "Date";

function stringifyHits({ checker }: Project, nodes: readonly Node[]): readonly Hit[] {
  const operands = nodes.flatMap(stringifiedOperands);
  const types = typesOf(checker, operands);
  return operands.flatMap((node, index) =>
    isDateType(checker, types[index])
      ? [{ detail: "Date を文字列にすると端末のタイムゾーンで書く", node: node.parent! }]
      : [],
  );
}

const findingAt =
  (file: SourceFile, relative: string) =>
  ({ detail, node }: Hit): Finding => ({ ...locate(file, node), detail, file: relative });

const scanFile = (project: Project, file: SourceFile, relative: string): readonly Finding[] => {
  if (OWNERS.has(relative)) return [];
  const nodes = descendants(file);
  return [
    ...namedHits(project, nodes),
    ...bindingHits(project, nodes),
    ...stringifyHits(project, nodes),
  ].map(findingAt(file, relative));
};

const BROWSER_SCRIPTS = "tools/checks/browser-scripts.tsconfig.json";

const scan = (scope: Scope): readonly Finding[] => [
  ...scanProject(scope, scanFile),
  ...scanProject({ ...scope, project: BROWSER_SCRIPTS }, scanFile),
];

const localTimeCheck = { BROWSER_SCRIPTS, OWNERS, scan };

export default localTimeCheck;
