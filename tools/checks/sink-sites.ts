import { SyntaxKind } from "typescript/unstable/ast";
import type { ElementAccessExpression, Node } from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Symbol as TsSymbol, Type } from "typescript/unstable/sync";

import type sinkSitesTypes from "./sink-sites.types.ts";
import typedProject from "./typed-project.ts";

const { isDefaultLib, resolveAlias, typesOf } = typedProject;

type Hit = sinkSitesTypes.Hit;

type Access = sinkSitesTypes.Access;

type Site = sinkSitesTypes.Site;

type Resolved = sinkSitesTypes.Resolved;

type SiteRule = sinkSitesTypes.SiteRule;

const GLOBAL = "";

const ATTRIBUTE_NAME_AT: ReadonlyMap<string, number> = new Map([
  ["createAttribute", 0],
  ["createAttributeNS", 1],
  ["setAttribute", 0],
  ["setAttributeNS", 1],
  ["toggleAttribute", 0],
]);

const ASSIGNMENTS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

const keyText = (key: Node): string | undefined =>
  isStringLiteral(key) || isNoSubstitutionTemplateLiteral(key) ? key.text : undefined;

const elementAccess = (node: ElementAccessExpression): Access | undefined => {
  const name = keyText(node.argumentExpression);
  return name === undefined
    ? undefined
    : { key: node.argumentExpression, name, receiver: node.expression };
};

const accessOf = (node: Node): Access | undefined => {
  if (isIdentifier(node)) return { key: node, name: node.text, receiver: node };
  if (isPropertyAccessExpression(node))
    return { key: node.name, name: node.name.text, receiver: node.expression };
  return isElementAccessExpression(node) ? elementAccess(node) : undefined;
};

const siteWith = (
  access: Access | undefined,
  node: Node,
  values: readonly Node[],
): Site | undefined => (access === undefined ? undefined : { ...access, node, values });

const assignmentSite = (node: Node): Site | undefined =>
  isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)
    ? siteWith(accessOf(node.left), node, [node.right])
    : undefined;

const callSite = (node: Node): Site | undefined =>
  isCallExpression(node)
    ? siteWith(accessOf(node.expression), node, [...node.arguments])
    : undefined;

const siteOf = (node: Node): Site | undefined => assignmentSite(node) ?? callSite(node);

const isAssignment = (site: Site): boolean => isBinaryExpression(site.node);

const membersOf = (type: Type): readonly Type[] =>
  type.isUnionType() ? (type.getTypes() ?? []) : [type];

const hasTypeNamed = (type: Type | undefined, names: ReadonlySet<string>): boolean =>
  type !== undefined && membersOf(type).some((member) => names.has(member.getSymbol()?.name ?? ""));

const literalStrings = (type: Type | undefined): readonly string[] | undefined => {
  if (type === undefined) return undefined;
  const members = membersOf(type);
  const texts = members.flatMap((member) =>
    (member.flags & TypeFlags.StringLiteral) !== 0 && member.isLiteralType()
      ? [String(member.value)]
      : [],
  );
  return texts.length === members.length ? texts : undefined;
};

const isStringLike = (type: Type | undefined): boolean =>
  type !== undefined &&
  membersOf(type).some((member) => (member.flags & TypeFlags.StringLike) !== 0);

const fromLib = (symbol: TsSymbol | undefined): symbol is TsSymbol =>
  symbol !== undefined && isDefaultLib(symbol);

const libOrUnknown = (symbol: TsSymbol | undefined): boolean =>
  symbol === undefined || isDefaultLib(symbol);

const ownerOf = (symbol: TsSymbol): string => symbol.getParent()?.name ?? GLOBAL;

const libOwnedBy = (symbol: TsSymbol | undefined, owners: ReadonlySet<string>): boolean =>
  fromLib(symbol) && owners.has(ownerOf(symbol));

const argumentAt = (site: Site, at: ReadonlyMap<string, number>): Node | undefined => {
  const index = at.get(site.name);
  return index === undefined || isAssignment(site) ? undefined : site.values[index];
};

const argumentType = (
  checker: Checker,
  site: Site,
  at: ReadonlyMap<string, number>,
): { readonly type: Type | undefined } | undefined => {
  const value = argumentAt(site, at);
  return value === undefined ? undefined : { type: typesOf(checker, [value])[0] };
};

const libCall = (site: Resolved): boolean => !isAssignment(site) && fromLib(site.symbol);

const libWrite = (site: Resolved): boolean => isAssignment(site) && fromLib(site.symbol);

const nameArgument = (
  checker: Checker,
  site: Resolved,
  at: ReadonlyMap<string, number>,
): { readonly type: Type | undefined } | undefined =>
  fromLib(site.symbol) ? argumentType(checker, site, at) : undefined;

const firstValueIsString = (checker: Checker, site: Site): boolean => {
  const [value] = site.values;
  return value !== undefined && isStringLike(typesOf(checker, [value])[0]);
};

const accessed = (node: Node): Node | undefined =>
  isPropertyAccessExpression(node) || isElementAccessExpression(node) ? node.expression : undefined;

const accessOwner = (node: Node): Node | undefined => {
  const owner = node.parent === undefined ? undefined : accessed(node.parent);
  return owner === node ? undefined : owner;
};

const innerExpression = (node: Node): Node | undefined =>
  isCallExpression(node) ? node.expression : accessed(node);

const receiverRoot = (node: Node): Node | undefined => {
  let current = accessOwner(node);
  while (current !== undefined && !isIdentifier(current)) current = innerExpression(current);
  return current;
};

const isImportBinding = (symbol: TsSymbol | undefined): symbol is TsSymbol =>
  symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0;

const importedRoots = (
  checker: Checker,
  nodes: readonly Node[],
): readonly (TsSymbol | undefined)[] => {
  const roots = nodes.map(receiverRoot);
  const present = roots.filter((root): root is Node => root !== undefined);
  const symbols = present.length === 0 ? [] : checker.getSymbolAtLocation(present);
  let next = 0;
  return roots.map((root) => {
    if (root === undefined) return undefined;
    const symbol = symbols[next];
    next += 1;
    return isImportBinding(symbol) ? symbol : undefined;
  });
};

const symbolsOf = (checker: Checker, nodes: readonly Node[]): readonly (TsSymbol | undefined)[] => {
  if (nodes.length === 0) return [];
  const symbols = checker.getSymbolAtLocation(nodes);
  const imported = symbols.includes(undefined) ? importedRoots(checker, nodes) : [];
  return symbols.map((symbol, index) =>
    symbol === undefined ? imported[index] : resolveAlias(checker, symbol),
  );
};

const resolvedSites = (
  checker: Checker,
  nodes: readonly Node[],
  watched: ReadonlySet<string>,
): readonly Resolved[] => {
  const sites = nodes.flatMap((node) => siteOf(node) ?? []).filter(({ name }) => watched.has(name));
  const receivers = typesOf(
    checker,
    sites.map(({ receiver }) => receiver),
  );
  const symbols = symbolsOf(
    checker,
    sites.map(({ key }) => key),
  );
  return sites.map(
    (site, index) =>
      Object.assign(Object.create(null) as object, site, {
        receiverType: receivers[index],
        symbol: symbols[index],
      }) as Resolved,
  );
};

const siteHits = (
  checker: Checker,
  nodes: readonly Node[],
  watched: ReadonlySet<string>,
  rules: readonly SiteRule[],
): readonly Hit[] =>
  resolvedSites(checker, nodes, watched).flatMap((site) => {
    const detail = rules.map((rule) => rule(checker, site)).find((found) => found !== undefined);
    return detail === undefined ? [] : [{ detail, node: site.node }];
  });

const isAccessKey = (node: Node): boolean =>
  node.parent !== undefined &&
  isElementAccessExpression(node.parent) &&
  node.parent.argumentExpression === node;

const memberText = (node: Node): string | undefined =>
  isIdentifier(node) ? node.text : keyText(node);

const isMemberName = (node: Node, names: ReadonlySet<string>): boolean => {
  const text = memberText(node);
  return text !== undefined && names.has(text) && (isIdentifier(node) || isAccessKey(node));
};

const memberNames = (nodes: readonly Node[], names: ReadonlySet<string>): readonly Node[] =>
  nodes.filter((node) => isMemberName(node, names));

const nameOf = (node: Node): string => memberText(node) ?? "";

const memberHits = (
  checker: Checker,
  nodes: readonly Node[],
  names: ReadonlySet<string>,
  detailOf: (name: string, symbol: TsSymbol | undefined) => string | undefined,
): readonly Hit[] => {
  const found = memberNames(nodes, names);
  const symbols = symbolsOf(checker, found);
  return found.flatMap((node, index) => {
    const detail = detailOf(nameOf(node), symbols[index]);
    return detail === undefined ? [] : [{ detail, node }];
  });
};

const sinkSites = {
  ATTRIBUTE_NAME_AT,
  GLOBAL,
  argumentAt,
  argumentType,
  assignmentSite,
  firstValueIsString,
  fromLib,
  hasTypeNamed,
  isAssignment,
  keyText,
  libCall,
  libOrUnknown,
  libOwnedBy,
  libWrite,
  literalStrings,
  memberHits,
  nameArgument,
  ownerOf,
  siteHits,
};

export default sinkSites;
