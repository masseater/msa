import { SyntaxKind } from "typescript/unstable/ast";
import type { Node } from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isStringLiteral,
  isTemplateExpression,
} from "typescript/unstable/ast/is";

type Embedded = { readonly detail: string; readonly index: number };

const SUBSTITUTION = "\u0000";

const SCRIPT_OWNER = "scripts/inline-script.ts";

const MOVE = `素の .js に出し tools/checks/browser-scripts.tsconfig.json の include に入れ、${SCRIPT_OWNER} で差し込む`;

const SCRIPT_OPEN = /<script\b([^>]*)(>?)/giu;

const STATIC_DATA =
  /\b(?:src\s*=(?!\s*["']?\s*(?:data|blob):)|type\s*=\s*["']?application\/(?:ld\+)?json\b)/iu;

const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;

const HANDLER = /(?:^|[\s"'/\0])on[a-z]+(?:=|\s*=\s*["'])/giu;

const JS_URL = /javascript:\s*[^\s"'\0]/giu;

const SCRIPT = "script 要素の中身を文字列に書くとブラウザ用 JS が検査に入らない";

const ATTRIBUTE = "on* 属性に JS を書くとブラウザ用 JS が検査に入らない。addEventListener で付ける";

const URL_JS = "javascript スキームの URL に JS を書くとブラウザ用 JS が検査に入らない";

const isStaticData = (attributes: string): boolean =>
  !attributes.includes(SUBSTITUTION) && STATIC_DATA.test(attributes);

const scriptOpeners = (text: string): readonly Embedded[] =>
  [...text.matchAll(SCRIPT_OPEN)].flatMap(({ 1: attributes = "", 2: closed, index }) =>
    closed === ">" && isStaticData(attributes) ? [] : [{ detail: SCRIPT, index }],
  );

const matches = (pattern: RegExp, detail: string) => (text: string) =>
  [...text.matchAll(pattern)].map(({ index }) => ({ detail, index }));

const RULES: readonly ((text: string) => readonly Embedded[])[] = [
  scriptOpeners,
  matches(HANDLER, ATTRIBUTE),
  matches(JS_URL, URL_JS),
];

const problems = (text: string): readonly Embedded[] => RULES.flatMap((rule) => rule(text));

const pieceText = (node: Node): string | undefined => {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!isTemplateExpression(node)) return undefined;
  return [node.head.text, ...node.templateSpans.map(({ literal }) => literal.text)].join(
    SUBSTITUTION,
  );
};

const isConcat = (node: Node): boolean =>
  isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.PlusToken;

const unwrap = (node: Node): Node =>
  isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const joined = (node: Node): string => {
  const inner = unwrap(node);
  if (isConcat(inner) && isBinaryExpression(inner)) return joined(inner.left) + joined(inner.right);
  return pieceText(inner) ?? SUBSTITUTION;
};

const outerParent = (node: Node): Node | undefined =>
  node.parent !== undefined && isParenthesizedExpression(node.parent)
    ? outerParent(node.parent)
    : node.parent;

const isStringRoot = (node: Node): boolean => {
  if (!isConcat(node) && pieceText(node) === undefined) return false;
  const parent = outerParent(node);
  return parent === undefined || !isConcat(parent);
};

const inStrings = (
  nodes: readonly Node[],
): readonly { readonly detail: string; readonly node: Node }[] =>
  nodes
    .filter(isStringRoot)
    .flatMap((node) =>
      problems(joined(node)).map(({ detail }) => ({ detail: `${detail}。${MOVE}`, node })),
    );

const PLACEHOLDER = /^\s*\{\{[A-Z_]+\}\}\s*$/u;

const scriptBodies = (text: string): readonly Embedded[] =>
  [...text.matchAll(SCRIPT_ELEMENT)].flatMap(({ 1: attributes = "", 2: body = "", index }) =>
    isStaticData(attributes) || PLACEHOLDER.test(body) ? [] : [{ detail: SCRIPT, index }],
  );

const inHtml = (text: string): readonly Embedded[] => [
  ...scriptBodies(text),
  ...matches(HANDLER, ATTRIBUTE)(text),
  ...matches(JS_URL, URL_JS)(text),
];

const embeddedScript = { SCRIPT_OWNER, inHtml, inStrings };

export default embeddedScript;
