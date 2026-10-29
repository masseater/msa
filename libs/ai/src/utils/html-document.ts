import { Brand } from "effect";

import type htmlDocumentTypes from "./html-document.types.ts";

const asHtmlDocument = Brand.nominal<htmlDocumentTypes.HtmlDocument>();

const SCRIPT_TAG = /<(\/?script)/giu;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const withoutScripts = (markup: string): string => markup.replace(SCRIPT_TAG, "&lt;$1");

const contentSecurityPolicy = (imageSources: readonly string[]): string =>
  [
    "default-src 'none'",
    ...(imageSources.length === 0 ? [] : [`img-src ${imageSources.join(" ")}`]),
    "style-src 'unsafe-inline'",
    "form-action 'none'",
  ].join("; ");

const attributesOf = (attributes: Readonly<Record<string, string>>): string =>
  Object.entries(attributes)
    .map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`)
    .join("");

const htmlDocument = (
  document: htmlDocumentTypes.HtmlDocumentParts,
): htmlDocumentTypes.HtmlDocument =>
  asHtmlDocument(
    withoutScripts(`<!doctype html>
<html${attributesOf({ lang: document.lang ?? "en", ...document.htmlAttributes })}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(document.imageSources ?? [])}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${document.head ?? ""}<title>${escapeHtml(document.title)}</title>
<style>
${document.style}
</style>
</head>
<body>
${document.body}
</body>
</html>
`),
  );

const writeHtmlFile = <R>(
  write: (path: string, data: string) => R,
  path: string,
  document: htmlDocumentTypes.HtmlDocument,
): R => write(path, document);

const htmlReply = (
  status: number,
  document: htmlDocumentTypes.HtmlDocument,
): htmlDocumentTypes.HtmlReply => ({
  body: document,
  headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  status,
});

const htmlDocumentModule = {
  escapeHtml,
  htmlDocument,
  htmlReply,
  writeHtmlFile,
};

export default htmlDocumentModule;
