import type aiTypes from "@msa/ai/index.types";

type Content =
  | string
  | readonly (
      | aiTypes.TextContent
      | aiTypes.ImageContent
      | aiTypes.ThinkingContent
      | aiTypes.ToolCall
    )[];

const textOf = (content: Content | undefined, separator = ""): string =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(separator);

const oneLine = (text: string): string => text.replaceAll(/[\n\t]/gu, " ").trim();

const HOME = /^\/(?:Users|home)\/[^/]+(?=\/|$)/u;

const shortenHomePath = (path: string): string => path.replace(HOME, "~");

const truncate = (text: string, max = 100): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`;

const entryText = { oneLine, shortenHomePath, textOf, truncate };

export default entryText;
