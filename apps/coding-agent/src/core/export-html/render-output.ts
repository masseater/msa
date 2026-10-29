import type aiTypes from "@msa/ai/index.types";

import htmlModule from "../../utils/html.ts";
import markdown from "./markdown.ts";

const { escapeXml } = htmlModule;
const { highlightIn } = markdown;

const LANGUAGES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    bash: "bash",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    dockerfile: "dockerfile",
    go: "go",
    h: "c",
    hpp: "cpp",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
  }),
);

const languageOf = (path: string): string | undefined =>
  LANGUAGES.get(path.split(".").at(-1)?.toLowerCase() ?? "");

const untab = (text: string): string => text.replaceAll("\t", "   ");

const plainLines = (lines: readonly string[]): string =>
  lines.map((line) => `<div>${escapeXml(untab(line))}</div>`).join("");

const codeBlock = (code: string, language: string): string =>
  `<pre><code class="hljs">${highlightIn(code, language)}</code></pre>`;

const expandable = (preview: string, full: string, remaining: number, extra = ""): string =>
  `<details class="tool-output expandable follows-tools${extra}"><summary><div class="output-preview">${preview}</div><div class="expand-hint">... (${remaining} more lines)</div></summary><div class="output-full">${full}</div></details>`;

const formatOutput = (raw: string, maxLines: number, language?: string): string => {
  const text = untab(raw);
  const lines = text.split("\n");
  const remaining = lines.length - maxLines;
  const preview = lines.slice(0, maxLines);
  if (language !== undefined) {
    return remaining > 0
      ? expandable(codeBlock(preview.join("\n"), language), codeBlock(text, language), remaining)
      : `<div class="tool-output">${codeBlock(text, language)}</div>`;
  }
  return remaining > 0
    ? expandable(plainLines(preview), plainLines(lines), remaining)
    : `<div class="tool-output">${plainLines(preview)}</div>`;
};

const zoomableImage = (image: aiTypes.ImageContent, className: string): string =>
  `<label class="image-zoom"><input type="checkbox"><img src="data:${escapeXml(image.mimeType || "image/png")};base64,${escapeXml(image.data || "")}" class="${className}" alt=""></label>`;

const imagesOf = (
  content: string | readonly { readonly type: string }[] | undefined,
): readonly aiTypes.ImageContent[] =>
  typeof content === "string" || content === undefined
    ? []
    : content.filter((block): block is aiTypes.ImageContent => block.type === "image");

const images = (list: readonly aiTypes.ImageContent[], wrapper: string, className: string) =>
  list.length === 0
    ? ""
    : `<div class="${wrapper}">${list.map((image) => zoomableImage(image, className)).join("")}</div>`;

const renderOutput = { expandable, formatOutput, images, imagesOf, languageOf, untab };

export default renderOutput;
