const CJK_CLASS = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー々〆ヶ`;
const CJK_RUN = new RegExp(`[${CJK_CLASS}]+`, "gu");
const CJK_CHAR = new RegExp(`[${CJK_CLASS}]`, "u");
const OTHER_WORD_CHAR = String.raw`(?:(?![${CJK_CLASS}])[\p{L}\p{N}\p{Co}])`;
const WORD = /[\p{L}\p{N}\p{Co}]+/gu;
const SEPARATORS = "[^\\p{L}\\p{N}\\p{Co}]*";

function normalize(text: string): string {
  return text.normalize("NFKC");
}

function runTokens(run: string): string[] {
  const chars = [...run];
  return chars.map((char, index) =>
    index < chars.length - 1 ? `${char}${chars[index + 1]}` : char,
  );
}

function indexText(text: string): string {
  return normalize(text).replaceAll(CJK_RUN, (run) => ` ${runTokens(run).join(" ")} `);
}

interface Segment {
  cjk: boolean;
  text: string;
}

function segments(text: string): Segment[] {
  const found: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    if (match.index > last) found.push({ cjk: false, text: text.slice(last, match.index) });
    found.push({ cjk: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) found.push({ cjk: false, text: text.slice(last) });
  return found;
}

interface TermTokens {
  tokens: string[];
  prefix: boolean;
}

function lastRunTokens(run: string): TermTokens {
  const chars = [...run];
  if (chars.length === 1) return { prefix: true, tokens: chars };
  return { prefix: false, tokens: runTokens(run).slice(0, -1) };
}

function termTokens(term: string): TermTokens {
  const parts = segments(normalize(term));
  const tokens: string[] = [];
  let prefix = false;
  parts.forEach((part, index) => {
    if (!part.cjk) {
      tokens.push(...(part.text.match(WORD) ?? []));
      return;
    }
    if (index < parts.length - 1) {
      tokens.push(...runTokens(part.text));
      return;
    }
    const last = lastRunTokens(part.text);
    tokens.push(...last.tokens);
    prefix = last.prefix;
  });
  return { prefix, tokens };
}

function splitTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/gu)) {
    const term = match[1] ?? match[2] ?? "";
    if (term.trim() !== "") terms.push(term);
  }
  return terms;
}

function matchExpression(query: string): string {
  return splitTerms(query)
    .map(termTokens)
    .filter((term) => term.tokens.length > 0)
    .map((term) => `"${term.tokens.join(" ")}"${term.prefix ? " *" : ""}`)
    .join(" AND ");
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function termPattern(term: string): string {
  const words = term.normalize("NFKC").match(WORD) ?? [];
  const pattern = words.map(escapeRegExp).join(SEPARATORS);
  if (pattern === "") return "";
  const first = words[0]?.at(0) ?? "";
  const last = words.at(-1)?.at(-1) ?? "";
  const before = CJK_CHAR.test(first) ? "" : `(?<!${OTHER_WORD_CHAR})`;
  const after = CJK_CHAR.test(last) ? "" : `(?!${OTHER_WORD_CHAR})`;
  return `${before}${pattern}${after}`;
}

function highlightPattern(query: string): RegExp | undefined {
  const alternatives = splitTerms(query)
    .map(termPattern)
    .filter((pattern) => pattern !== "");
  if (alternatives.length === 0) return undefined;
  return new RegExp(alternatives.join("|"), "iu");
}

const terms = { highlightPattern, indexText, matchExpression };

export default terms;
