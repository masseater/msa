import { Marked } from "marked";
import type { Tokens } from "marked";

import highlightLanguages from "../../utils/highlight-languages.ts";
import htmlModule from "../../utils/html.ts";

const { highlightJs } = highlightLanguages;
const { escapeXml } = htmlModule;

const STRICT_STRIKETHROUGH = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/u;

const ALLOWED_SCHEME = /^(?:https?|mailto|tel|ftp)$/iu;

const SCHEME = /^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*):/u;

const safeUrl = (value: string): string | undefined => {
  const href = value.trim().replaceAll(/\p{Cc}/gu, "");
  const scheme = SCHEME.exec(href)?.groups?.["scheme"];
  return scheme === undefined || ALLOWED_SCHEME.test(scheme) ? href : undefined;
};

const titleAttribute = (title: string | null | undefined): string =>
  title === null || title === undefined || title === "" ? "" : ` title="${escapeXml(title)}"`;

const highlightCode = (code: string, language: string | undefined): string => {
  try {
    return language !== undefined && highlightJs.getLanguage(language) !== undefined
      ? highlightJs.highlight(code, { ignoreIllegals: true, language }).value
      : highlightJs.highlightAuto(code).value;
  } catch {
    return escapeXml(code);
  }
};

const highlightIn = (code: string, language: string | undefined): string => {
  if (language === undefined || highlightJs.getLanguage(language) === undefined) {
    return escapeXml(code);
  }
  return highlightJs.highlight(code, { ignoreIllegals: true, language }).value;
};

const marked = new Marked({
  breaks: true,
  gfm: true,
  renderer: {
    code: ({ lang, text }: Tokens.Code) =>
      `<pre><code class="hljs">${highlightCode(text, lang === undefined || lang === "" ? undefined : lang)}</code></pre>`,
    codespan: ({ text }: Tokens.Codespan) => `<code>${escapeXml(text)}</code>`,
    image: ({ href, text, title }: Tokens.Image) => {
      const url = safeUrl(href);
      return url === undefined
        ? escapeXml(text)
        : `<img src="${escapeXml(url)}" alt="${escapeXml(text)}"${titleAttribute(title)}>`;
    },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      const url = safeUrl(token.href);
      return url === undefined
        ? inner
        : `<a href="${escapeXml(url)}"${titleAttribute(token.title)}>${inner}</a>`;
    },
  },
  tokenizer: {
    del(src: string) {
      const match = STRICT_STRIKETHROUGH.exec(src);
      if (match === null) return undefined;
      const text = match[2] ?? "";
      return { raw: match[0], text, tokens: this.lexer.inlineTokens(text), type: "del" };
    },
    html: () => undefined,
    tag: () => undefined,
  },
});

const renderMarkdown = (text: string): string => marked.parse(text, { async: false });

const markdown = { highlightIn, renderMarkdown };

export default markdown;
