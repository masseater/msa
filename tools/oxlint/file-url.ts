import type { Context, ESTree } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import scopeLookup from "./scope-lookup.ts";

type Node = flowTypes.Node;

const URL_SPECIFIERS: ReadonlySet<string> = new Set(["node:url", "url"]);
const FACTORY = "pathToFileURL";
const WRAPPERS: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

const unwrap = (node: Node): Node =>
  WRAPPERS.has(node.type) ? unwrap((node as { readonly expression: Node }).expression) : node;

const importOf = (context: Context, node: Node): ESTree.ImportDeclarationSpecifier | undefined => {
  const def = scopeLookup.variableOf(context, node)?.defs[0];
  if (def?.type !== "ImportBinding") return undefined;
  const declaration = def.parent as ESTree.ImportDeclaration;
  return URL_SPECIFIERS.has(declaration.source.value)
    ? (def.node as ESTree.ImportDeclarationSpecifier)
    : undefined;
};

const importsFactory = (specifier: ESTree.ImportDeclarationSpecifier | undefined): boolean =>
  specifier?.type === "ImportSpecifier" &&
  specifier.imported.type === "Identifier" &&
  specifier.imported.name === FACTORY;

const importsModule = (specifier: ESTree.ImportDeclarationSpecifier | undefined): boolean =>
  specifier !== undefined && specifier.type !== "ImportSpecifier";

const isFactory = (context: Context, callee: Node): boolean => {
  if (callee.type === "Identifier") return importsFactory(importOf(context, callee));
  return (
    scopeLookup.staticMemberName(callee) === FACTORY &&
    importsModule(importOf(context, (callee as ESTree.MemberExpression).object))
  );
};

type FormCheck = (context: Context, node: Node) => boolean;

const leadingExpression = (node: ESTree.TemplateLiteral): Node | undefined =>
  node.quasis[0]?.value.cooked === "" ? node.expressions[0] : undefined;

const isFileUrl = (context: Context, raw: Node): boolean => {
  const node = unwrap(raw);
  const check = FILE_URL_FORMS[node.type];
  return check !== undefined && check(context, node);
};

const followed = (context: Context, node: Node | undefined): boolean =>
  node !== undefined && isFileUrl(context, node);

const FILE_URL_FORMS: Readonly<Record<string, FormCheck>> = {
  BinaryExpression: (context, node) =>
    (node as ESTree.BinaryExpression).operator === "+" &&
    isFileUrl(context, (node as ESTree.BinaryExpression).left),
  CallExpression: (context, node) => isFactory(context, (node as ESTree.CallExpression).callee),
  MemberExpression: (context, node) =>
    scopeLookup.staticMemberName(node) === "href" &&
    isFileUrl(context, (node as ESTree.MemberExpression).object),
  TemplateLiteral: (context, node) =>
    followed(context, leadingExpression(node as ESTree.TemplateLiteral)),
};

const fileUrl = { isFileUrl };

export default fileUrl;
