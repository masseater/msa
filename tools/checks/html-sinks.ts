import type { Node } from "typescript/unstable/ast";
import { isCallExpression, isIdentifier } from "typescript/unstable/ast/is";
import type { Checker, Project, Symbol as TsSymbol } from "typescript/unstable/sync";

import sinkSites from "./sink-sites.ts";
import type sinkSitesTypes from "./sink-sites.types.ts";
import typedProject from "./typed-project.ts";

type Hit = sinkSitesTypes.Hit;

type Resolved = sinkSitesTypes.Resolved;

type Site = sinkSitesTypes.Site;

type SiteRule = sinkSitesTypes.SiteRule;

const { declaredIn } = typedProject;

const {
  ATTRIBUTE_NAME_AT,
  GLOBAL,
  argumentAt,
  isAssignment,
  libOrUnknown,
  libOwnedBy,
  literalStrings,
  memberHits,
  nameArgument,
  siteHits,
} = sinkSites;

const HTML_OWNER = "apps/coding-agent/src/core/export-html/html-fragment.js";

const HTML_OWNER_FILE = /\/apps\/coding-agent\/src\/core\/export-html\/html-fragment\.js$/u;

const HTML_RUNS = `HTML を文字列から作る API は、中の script や on* 属性をブラウザで JS として動かし、その JS は検査に入らない。${HTML_OWNER} の htmlFragment で DOM にしてから replaceChildren などで入れる`;

const NAVIGATION_RUNS = `javascript スキームの URL に移る行き先に入れた文字列は、ブラウザで JS として動き、検査に入らない。${HTML_OWNER} の safeUrl(...) を通した値だけを入れる`;

const HTML_PROPERTIES: ReadonlySet<string> = new Set(["innerHTML", "outerHTML", "srcdoc"]);

const HTML_METHODS: ReadonlySet<string> = new Set([
  "afterHTMLUnsafe",
  "appendHTMLUnsafe",
  "beforeHTMLUnsafe",
  "createContextualFragment",
  "insertAdjacentHTML",
  "parseFromString",
  "parseHTMLUnsafe",
  "prependHTMLUnsafe",
  "replaceWithHTMLUnsafe",
  "setHTMLUnsafe",
]);

const DOCUMENT_WRITES: ReadonlySet<string> = new Set(["write", "writeln"]);

const NAVIGATION_PROPERTIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["action", new Set(["HTMLFormElement"])],
  ["baseVal", new Set(["SVGAnimatedString"])],
  ["formAction", new Set(["HTMLButtonElement", "HTMLInputElement"])],
  [
    "href",
    new Set(["HTMLAnchorElement", "HTMLAreaElement", "HTMLHyperlinkElementUtils", "Location"]),
  ],
  ["location", new Set(["Document", "Window", GLOBAL])],
  ["src", new Set(["HTMLFrameElement", "HTMLIFrameElement"])],
]);

const NAVIGATION_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["assign", new Set(["Location"])],
  ["open", new Set(["Document", "Window", GLOBAL])],
  ["replace", new Set(["Location"])],
]);

const URL_ATTRIBUTE_AT: ReadonlyMap<string, number> = new Map([
  ["setAttribute", 1],
  ["setAttributeNS", 2],
]);

const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["action", "formaction", "href", "src"]);

const htmlProperty: SiteRule = (_checker, site) =>
  isAssignment(site) && HTML_PROPERTIES.has(site.name) && libOrUnknown(site.symbol)
    ? HTML_RUNS
    : undefined;

const calleeName = (value: Node): Node | undefined =>
  isCallExpression(value) && isIdentifier(value.expression) ? value.expression : undefined;

const isOwnerSafeUrl = (symbol: TsSymbol | undefined): boolean =>
  symbol !== undefined && symbol.name === "safeUrl" && declaredIn(symbol, HTML_OWNER_FILE);

const isSafeUrl = (checker: Checker, value: Node): boolean => {
  const callee = calleeName(value);
  return callee !== undefined && isOwnerSafeUrl(checker.getSymbolAtLocation([callee])[0]);
};

const navigationValue = (site: Site): Node | undefined =>
  isAssignment(site) ? site.values[0] : (argumentAt(site, URL_ATTRIBUTE_AT) ?? site.values[0]);

const navigationOwners = (site: Resolved): ReadonlySet<string> | undefined =>
  (isAssignment(site) ? NAVIGATION_PROPERTIES : NAVIGATION_METHODS).get(site.name);

const unresolvedMemberWrite = (site: Resolved): boolean =>
  isAssignment(site) && site.symbol === undefined && site.receiver !== site.key;

const navigationTarget = (site: Resolved): boolean => {
  const owners = navigationOwners(site);
  return owners !== undefined && (unresolvedMemberWrite(site) || libOwnedBy(site.symbol, owners));
};

const isUrlAttribute = (name: string): boolean =>
  URL_ATTRIBUTES.has(name.split(":").at(-1)!.toLowerCase());

const attributeNames = (checker: Checker, site: Resolved): readonly string[] => {
  const argument = nameArgument(checker, site, ATTRIBUTE_NAME_AT);
  return argument === undefined ? [] : (literalStrings(argument.type) ?? []);
};

const urlAttribute = (checker: Checker, site: Resolved): boolean =>
  URL_ATTRIBUTE_AT.has(site.name) && attributeNames(checker, site).some(isUrlAttribute);

const isNavigation = (checker: Checker, site: Resolved): boolean =>
  navigationTarget(site) || urlAttribute(checker, site);

const isUnsafeValue = (checker: Checker, value: Node | undefined): boolean =>
  value !== undefined && !isSafeUrl(checker, value);

const navigation: SiteRule = (checker, site) =>
  isNavigation(checker, site) && isUnsafeValue(checker, navigationValue(site))
    ? NAVIGATION_RUNS
    : undefined;

const htmlMember = (name: string, symbol: TsSymbol | undefined): string | undefined => {
  if (DOCUMENT_WRITES.has(name))
    return libOwnedBy(symbol, new Set(["Document"])) ? HTML_RUNS : undefined;
  return libOrUnknown(symbol) ? HTML_RUNS : undefined;
};

const HTML_MEMBER_NAMES: ReadonlySet<string> = new Set([...HTML_METHODS, ...DOCUMENT_WRITES]);

const htmlHits = ({ checker }: Project, nodes: readonly Node[]): readonly Hit[] => [
  ...siteHits(checker, nodes, HTML_PROPERTIES, [htmlProperty]),
  ...memberHits(checker, nodes, HTML_MEMBER_NAMES, htmlMember),
];

const NAVIGATION_WATCHED: ReadonlySet<string> = new Set([
  ...NAVIGATION_PROPERTIES.keys(),
  ...NAVIGATION_METHODS.keys(),
  ...URL_ATTRIBUTE_AT.keys(),
]);

const navigationHits = ({ checker }: Project, nodes: readonly Node[]): readonly Hit[] =>
  siteHits(checker, nodes, NAVIGATION_WATCHED, [navigation]);

const htmlSinks = { HTML_OWNER, htmlHits, navigationHits };

export default htmlSinks;
