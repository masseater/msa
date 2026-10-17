import type { ImageContent, TextContent } from "@msa/ai";
import type { CodemodeOutputItem, CodemodeResult } from "@msa/codemode/portable";
import { Effect } from "effect";

type Item = TextContent | ImageContent;

export type OutputFile = (
  name: string,
  data: string | Uint8Array,
) => Promise<{ path: string } | { error: string }>;

type Limits = { readonly maxBytes: number; readonly maxLines: number };
const LINE_MARGIN = 100;

export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const CHARS_PER_TOKEN = 4;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function formatItems(output: readonly CodemodeOutputItem[]): Item[] {
  const total = output.filter((item) => item.type === "text" && item.console !== true).length;
  const items: Item[] = [];
  const consoleLines: string[] = [];
  let index = 0;
  for (const item of output) {
    if (item.type === "image") items.push(item);
    else if (item.console === true) consoleLines.push(item.text);
    else {
      index++;
      items.push({
        type: "text",
        text: total > 1 ? `==> text ${index}/${total} <==\n${item.text}` : item.text,
      });
    }
  }
  if (consoleLines.length > 0) {
    items.push({
      type: "text",
      text: `<console_output>\n${consoleLines.join("\n")}\n</console_output>`,
    });
  }
  return items;
}

function joinAdjacentText(items: readonly Item[]): Item[] {
  const joined: Item[] = [];
  let parts: string[] = [];
  let lastPart = "";
  const flush = () => {
    if (parts.length > 0) joined.push({ type: "text", text: parts.join("") });
    parts = [];
    lastPart = "";
  };
  for (const item of items) {
    if (item.type !== "text") {
      flush();
      joined.push(item);
      continue;
    }
    if (lastPart !== "" && !lastPart.endsWith("\n")) {
      parts.push("\n");
      lastPart = "\n";
    }
    parts.push(item.text);
    if (item.text !== "") lastPart = item.text;
  }
  flush();
  return joined;
}

type Truncated = { items: Item[]; fullOutputPath?: string };

const truncate = Effect.fnUntraced(function* (
  items: readonly Item[],
  maxTokens: number,
  limits: Limits,
  write: OutputFile,
) {
  const texts = items
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text);
  const combined = texts.join("\n");
  const budget = Math.min(maxTokens * CHARS_PER_TOKEN, Math.floor(limits.maxBytes / 4));
  const lineBudget = Math.floor((limits.maxLines - LINE_MARGIN) / 2);
  const lines = combined.split("\n").length;
  if (texts.length === 0 || (combined.length <= budget && lines <= 2 * lineBudget)) {
    const kept: Truncated = { items: [...items] };
    return kept;
  }
  const headChars = Math.floor(budget / 2);
  const tailChars = budget - headChars;
  const head = combined.slice(0, headChars).split("\n").slice(0, lineBudget).join("\n");
  const tail =
    tailChars > 0 ? combined.slice(-tailChars).split("\n").slice(-lineBudget).join("\n") : "";
  const removed = combined.length - head.length - tail.length;
  let text = `Warning: truncated output (original token count: ${Math.ceil(combined.length / CHARS_PER_TOKEN)})\nTotal output lines: ${combined.split("\n").length}\n\n${head}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail}`;
  const spilled = yield* Effect.promise(() => write("output.txt", combined));
  text +=
    "path" in spilled
      ? `\n\n[Full output: ${spilled.path} (read with offset/limit)]`
      : `\n\n[Could not save the full output: ${spilled.error}]`;
  const truncated: Truncated = {
    items: [{ type: "text", text }, ...items.filter((item) => item.type === "image")],
    ...("path" in spilled ? { fullOutputPath: spilled.path } : {}),
  };
  return truncated;
});

const imageLabel = Effect.fnUntraced(function* (
  { data, mimeType }: ImageContent,
  index: number,
  write: OutputFile,
) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const kind = `${mimeType}, ${bytes.length} bytes`;
  const name = `image-${index}${IMAGE_EXTENSIONS[mimeType] ?? ".bin"}`;
  const saved = yield* Effect.promise(() => write(name, bytes));
  return "path" in saved
    ? `[Image saved to ${saved.path} (${kind})]`
    : `[Image (${kind}) could not be saved: ${saved.error}]`;
});

const saveImages = Effect.fnUntraced(function* (items: readonly Item[], write: OutputFile) {
  const images = new Map<string, ImageContent>();
  for (const item of items) {
    if (item.type === "image" && !images.has(item.data)) images.set(item.data, item);
  }
  const labels = yield* Effect.forEach(
    [...images.values()],
    (image, index) => imageLabel(image, index + 1, write),
    { concurrency: "unbounded" },
  );
  const labelOf = new Map([...images.keys()].map((data, index) => [data, labels[index]!]));
  return items.flatMap((item): Item[] =>
    item.type === "image" ? [{ type: "text", text: labelOf.get(item.data)! }, item] : [item],
  );
});

function formatError(
  result: Extract<CodemodeResult, { ok: false }>,
  calls: readonly { name: string; status: string }[],
) {
  const { error } = result;
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`;
  const summary =
    calls.length === 0
      ? "No tool calls were made."
      : `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
  return `${head}\n\n${summary}`;
}

export const formatResult = Effect.fnUntraced(function* (
  result: CodemodeResult,
  options: {
    readonly generatedImages: number;
    readonly wallMs: number;
    readonly maxOutputTokens: number;
    readonly calls: readonly { name: string; status: string }[];
    readonly limits: Limits;
    readonly write: OutputFile;
  },
) {
  const output = [...result.output];
  if (result.ok && result.value !== undefined)
    output.push({ type: "text", text: valueText(result.value) });
  const items = formatItems(output);
  if (!result.ok)
    items.push({ type: "text", text: `Script error:\n${formatError(result, options.calls)}` });
  const generated = options.generatedImages;
  if (generated > 0 && !items.some((item) => item.type === "image")) {
    items.push({
      type: "text",
      text: `Note: models.generateImages() returned ${generated} image${generated === 1 ? "" : "s"} that the script did not show. Show each image block of result.output with image(block).`,
    });
  }
  const truncated = yield* truncate(
    joinAdjacentText(items),
    options.maxOutputTokens,
    options.limits,
    options.write,
  );
  const content = joinAdjacentText(yield* saveImages(truncated.items, options.write));
  const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${(options.wallMs / 1000).toFixed(1)} seconds\nOutput:\n`;
  const formatted: { content: Item[]; fullOutputPath?: string } = {
    content: [{ type: "text", text: header }, ...content],
    ...(truncated.fullOutputPath === undefined ? {} : { fullOutputPath: truncated.fullOutputPath }),
  };
  return formatted;
});
