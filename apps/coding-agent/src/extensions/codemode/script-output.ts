import type aiTypes from "@msa/ai/index.types";
import type codemodeTypes from "@msa/codemode/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import truncate from "../../core/tools/truncate.ts";
import errors from "../../utils/errors.ts";
import outputFiles from "../../utils/output-files.ts";
import type toolTypes from "./tool.types.ts";

const { awaited, awaiting } = awaitingModule;
const { writeOutputFile } = outputFiles;
const { toErrorMessage } = errors;
const { formatSize } = truncate;

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

const CHARS_PER_TOKEN = 4;

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function formatOutput(
  output: readonly codemodeTypes.CodemodeOutputItem[],
): (aiTypes.TextContent | aiTypes.ImageContent)[] {
  const total = output.filter((item) => item.type === "text" && item.console === undefined).length;
  const items: (aiTypes.TextContent | aiTypes.ImageContent)[] = [];
  const consoleLines: string[] = [];
  let index = 0;
  for (const item of output) {
    if (item.type === "image") {
      items.push(item);
    } else if (item.console === undefined) {
      index++;
      items.push({
        text: total > 1 ? `==> text ${index}/${total} <==\n${item.text}` : item.text,
        type: "text",
      });
    } else {
      consoleLines.push(item.text);
    }
  }
  if (consoleLines.length > 0) {
    items.push({
      text: `<console_output>\n${consoleLines.join("\n")}\n</console_output>`,
      type: "text",
    });
  }
  return items;
}

function joinAdjacentText(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
): (aiTypes.TextContent | aiTypes.ImageContent)[] {
  const joined: (aiTypes.TextContent | aiTypes.ImageContent)[] = [];
  let parts: string[] = [];
  let lastPart = "";
  const flush = () => {
    if (parts.length > 0) joined.push({ text: parts.join(""), type: "text" });
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

function formatCallSummary(calls: readonly toolTypes.CodemodeNestedCall[]): string {
  if (calls.length === 0) return "No tool calls were made.";
  return `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
}

function formatError(
  result: Extract<codemodeTypes.CodemodeResult, { ok: false }>,
  calls: readonly toolTypes.CodemodeNestedCall[],
): string {
  const { error } = result;
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`;
  return `${head}\n\n${formatCallSummary(calls)}`;
}

function spillOutput(text: string): Promise<{ path: string } | { error: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        return { path: yield* awaited(writeOutputFile("msa-codemode", ".txt", text)) };
      } catch (error) {
        return { error: toErrorMessage(error) };
      }
    }),
  );
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function saveImages(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const labels = new Map<string, Promise<string>>();
      const label = ({ data, mimeType }: aiTypes.ImageContent): Promise<string> =>
        Effect.runPromise(
          awaiting(function* () {
            const bytes = Buffer.from(data, "base64");
            const kind = `${mimeType}, ${formatSize(bytes.length)}`;
            const extension = IMAGE_EXTENSIONS[mimeType];
            if (extension === undefined || extension === "")
              throw new Error(`No file extension for image type ${mimeType}`);

            try {
              const path = yield* awaited(writeOutputFile("msa-codemode", extension, bytes));
              return `[Image saved to ${path} (${kind})]`;
            } catch (error) {
              return `[Image (${kind}) could not be saved: ${toErrorMessage(error)}]`;
            }
          }),
        );
      const result = yield* awaited(
        Promise.all(
          items.map((item): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> =>
            Effect.runPromise(
              awaiting(function* () {
                if (item.type !== "image") return [item];
                let pending = labels.get(item.data);
                if (pending === undefined) {
                  pending = label(item);
                  labels.set(item.data, pending);
                }
                return [{ text: yield* awaited(pending), type: "text" }, item];
              }),
            ),
          ),
        ),
      );
      return result.flat();
    }),
  );
}

function truncateOutput(
  items: (aiTypes.TextContent | aiTypes.ImageContent)[],
  maxTokens: number,
): Promise<{ items: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      const texts = items
        .filter((item): item is aiTypes.TextContent => item.type === "text")
        .map((item) => item.text);
      const combined = texts.join("\n");
      const budget = maxTokens * CHARS_PER_TOKEN;
      if (texts.length === 0 || combined.length <= budget) return { items };
      const headChars = Math.floor(budget / 2);
      const tailChars = budget - headChars;
      const removed = combined.length - headChars - tailChars;
      const head = combined.slice(0, headChars);
      const tail = tailChars > 0 ? combined.slice(-tailChars) : "";
      let text = `Warning: truncated output (original token count: ${Math.ceil(combined.length / CHARS_PER_TOKEN)})\nTotal output lines: ${combined.split("\n").length}\n\n${head}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail}`;
      const spilled = yield* awaited(spillOutput(combined));
      text +=
        "path" in spilled
          ? `\n\n[Full output: ${spilled.path} (read with offset/limit)]`
          : `\n\n[Could not save the full output: ${spilled.error}]`;
      return {
        items: [{ text, type: "text" }, ...items.filter((item) => item.type === "image")],
        ...("path" in spilled ? { fullOutputPath: spilled.path } : {}),
      };
    }),
  );
}

interface ScriptResultInput {
  result: codemodeTypes.CodemodeResult;
  calls: readonly toolTypes.CodemodeNestedCall[];
  generatedImages: number;
  usage: toolTypes.CodemodeUsage | undefined;
  maxOutputTokens: number | undefined;
  startedAt: number;
}

function scriptItems({ result, calls, generatedImages }: ScriptResultInput) {
  const output = [...result.output];
  if (result.ok && result.value !== undefined) {
    output.push({ text: valueText(result.value), type: "text" });
  }
  const items = formatOutput(output);
  if (!result.ok)
    items.push({ text: `Script error:\n${formatError(result, calls)}`, type: "text" });
  if (generatedImages > 0 && !items.some((item) => item.type === "image")) {
    items.push({
      text: `Note: models.generateImages() returned ${generatedImages} image${generatedImages === 1 ? "" : "s"} that the script did not show. Show each image block of result.output with image(block).`,
      type: "text",
    });
  }
  return items;
}

function renderScriptResult(input: ScriptResultInput): Promise<toolTypes.CodemodeRunResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const { result } = input;
      const truncated = yield* awaited(
        truncateOutput(
          joinAdjacentText(scriptItems(input)),
          input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ),
      );
      const output = joinAdjacentText(yield* awaited(saveImages(truncated.items)));
      const wallTime = ((performance.now() - input.startedAt) / 1000).toFixed(1);
      const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${wallTime} seconds\nOutput:\n`;
      const details: toolTypes.CodemodeToolDetails = {
        calls: input.calls.map((call) => structuredClone(call)),
      };
      if (truncated.fullOutputPath !== undefined && truncated.fullOutputPath !== "")
        details.fullOutputPath = truncated.fullOutputPath;
      return {
        content: [{ text: header, type: "text" as const }, ...output],
        details,
        ...(input.usage === undefined ? {} : { usage: input.usage }),
        ...(result.ok ? {} : { isError: true }),
      };
    }),
  );
}

const scriptOutput = { renderScriptResult };

export default scriptOutput;
