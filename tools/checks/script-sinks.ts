import type { Node } from "typescript/unstable/ast";
import type { Project, Symbol as TsSymbol } from "typescript/unstable/sync";

import sinkSites from "./sink-sites.ts";
import type sinkSitesTypes from "./sink-sites.types.ts";

type Hit = sinkSitesTypes.Hit;

type SiteRule = sinkSitesTypes.SiteRule;

const {
  ATTRIBUTE_NAME_AT,
  assignmentSite,
  firstValueIsString,
  fromLib,
  hasTypeNamed,
  isAssignment,
  libCall,
  libOrUnknown,
  libWrite,
  literalStrings,
  memberHits,
  nameArgument,
  ownerOf,
  siteHits,
} = sinkSites;

const RUNS = "その文字列はブラウザで JS として動き、検査に入らない。素の .js に書いて検査に入れる";

const SCRIPT_TYPES: ReadonlySet<string> = new Set(["HTMLScriptElement", "SVGScriptElement"]);

const SCRIPT_PROPERTIES: ReadonlySet<string> = new Set([
  "innerHTML",
  "innerText",
  "outerHTML",
  "src",
  "text",
  "textContent",
]);

const SCRIPT_METHODS: ReadonlySet<string> = new Set([
  "append",
  "appendChild",
  "insertAdjacentHTML",
  "insertAdjacentText",
  "insertBefore",
  "prepend",
  "replaceChild",
  "replaceChildren",
  "setAttribute",
  "setAttributeNS",
  "setHTMLUnsafe",
]);

const ATTRIBUTE_NODE_METHODS: ReadonlySet<string> = new Set([
  "setAttributeNode",
  "setAttributeNodeNS",
  "setNamedItem",
  "setNamedItemNS",
]);

const ATTR_VALUES: ReadonlySet<string> = new Set(["nodeValue", "textContent", "value"]);

const ELEMENT_NAME_AT: ReadonlyMap<string, number> = new Map([
  ["createElement", 0],
  ["createElementNS", 1],
]);

const TIMERS: ReadonlySet<string> = new Set(["setInterval", "setTimeout"]);

const RUNNING_MEMBERS: ReadonlyMap<string, string> = new Map([
  ["register", "ServiceWorkerContainer"],
]);

const RUNNING_GLOBALS: ReadonlySet<string> = new Set(["SharedWorker", "Worker", "importScripts"]);

const RUNNING_ATTRIBUTE = /^(?:on|srcdoc$)/iu;

const scriptWrite: SiteRule = (_checker, site) => {
  const names = isAssignment(site) ? SCRIPT_PROPERTIES : SCRIPT_METHODS;
  return names.has(site.name) && hasTypeNamed(site.receiverType, SCRIPT_TYPES)
    ? `script 要素に中身や src を入れると、${RUNS}`
    : undefined;
};

const runsAttribute = (names: readonly string[] | undefined): boolean =>
  names === undefined || names.some((name) => RUNNING_ATTRIBUTE.test(name));

const attributeName: SiteRule = (checker, site) => {
  const argument = nameArgument(checker, site, ATTRIBUTE_NAME_AT);
  if (argument === undefined) return undefined;
  return runsAttribute(literalStrings(argument.type))
    ? `on* 属性と srcdoc 属性に入れた文字列はブラウザで JS として動く。属性名は on で始まらない文字列リテラルで書き、ハンドラは addEventListener で付ける`
    : undefined;
};

const attributeNode: SiteRule = (_checker, site) =>
  libCall(site) && ATTRIBUTE_NODE_METHODS.has(site.name)
    ? "Attr を差し込むと属性名を型で見分けられず、on* 属性の JS が検査に入らない。setAttribute に文字列リテラルの名前で書く"
    : undefined;

const attrValue: SiteRule = (_checker, site) =>
  isAssignment(site) &&
  ATTR_VALUES.has(site.name) &&
  hasTypeNamed(site.receiverType, new Set(["Attr"]))
    ? "Attr の値を書き換えると属性名を型で見分けられず、on* 属性の JS が検査に入らない。setAttribute に文字列リテラルの名前で書く"
    : undefined;

const elementName: SiteRule = (checker, site) => {
  const argument = nameArgument(checker, site, ELEMENT_NAME_AT);
  return argument === undefined || literalStrings(argument.type) !== undefined
    ? undefined
    : "要素名を文字列リテラルで書かないと、script 要素を作っても型で見分けられない";
};

const handlerProperty: SiteRule = (checker, site) =>
  libWrite(site) && /^on/iu.test(site.name) && firstValueIsString(checker, site)
    ? `on* プロパティに入れた${RUNS}`
    : undefined;

const timerString: SiteRule = (checker, site) =>
  libCall(site) && TIMERS.has(site.name) && firstValueIsString(checker, site)
    ? `${site.name} に渡した${RUNS}`
    : undefined;

const LOADS = "は渡した URL の中身をブラウザで JS として動かし、その JS は検査に入らない";

const runningGlobal = (name: string, symbol: TsSymbol | undefined): string | undefined =>
  libOrUnknown(symbol) ? `${name} ${LOADS}` : undefined;

const runningOwned = (name: string, symbol: TsSymbol | undefined): string | undefined =>
  fromLib(symbol) && RUNNING_MEMBERS.get(name) === ownerOf(symbol)
    ? `${ownerOf(symbol)}.${name} ${LOADS}`
    : undefined;

const runningMember = (name: string, symbol: TsSymbol | undefined): string | undefined =>
  RUNNING_GLOBALS.has(name) ? runningGlobal(name, symbol) : runningOwned(name, symbol);

const SCRIPT_WATCHED: ReadonlySet<string> = new Set([
  ...SCRIPT_PROPERTIES,
  ...SCRIPT_METHODS,
  ...ATTRIBUTE_NAME_AT.keys(),
  ...ATTRIBUTE_NODE_METHODS,
  ...ATTR_VALUES,
  ...ELEMENT_NAME_AT.keys(),
  ...TIMERS,
]);

const SCRIPT_RULES: readonly SiteRule[] = [
  scriptWrite,
  attributeName,
  attributeNode,
  attrValue,
  elementName,
  timerString,
  handlerProperty,
];

const RUNNING_NAMES: ReadonlySet<string> = new Set([...RUNNING_MEMBERS.keys(), ...RUNNING_GLOBALS]);

const handlerNames = (nodes: readonly Node[]): ReadonlySet<string> =>
  new Set(
    nodes.flatMap((node) => {
      const site = assignmentSite(node);
      return site !== undefined && /^on/iu.test(site.name) ? [site.name] : [];
    }),
  );

const scriptHits = ({ checker }: Project, nodes: readonly Node[]): readonly Hit[] => [
  ...siteHits(checker, nodes, new Set([...SCRIPT_WATCHED, ...handlerNames(nodes)]), SCRIPT_RULES),
  ...memberHits(checker, nodes, RUNNING_NAMES, runningMember),
];

const scriptSinks = { scriptHits };

export default scriptSinks;
