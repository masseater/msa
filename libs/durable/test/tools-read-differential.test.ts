import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { characterEnd } from "@msa/chord/output";
import { Cause, Effect, Exit } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import type { ToolDiagnostic, ToolExecutionApi } from "../src/harness/types.ts";
import { detectSupportedImageMimeType } from "../src/tools/image.ts";
import { createReadTool } from "../src/tools/read.ts";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "../src/truncate.ts";
import { awaited, makeTempDir, removeDirs, writeTempFile } from "./support.ts";

function selectLines(allLines: readonly string[], startLine: number, limit: number | undefined) {
  let selectedContent: string;
  let userLimitedLines: number | undefined;
  if (limit === undefined) {
    selectedContent = allLines.slice(startLine).join("\n");
  } else {
    const endLine = Math.min(startLine + limit, allLines.length);
    selectedContent = allLines.slice(startLine, endLine).join("\n");
    userLimitedLines = endLine - startLine;
  }
  return { selectedContent, userLimitedLines };
}

function truncationNotice(
  {
    headText,
    truncation,
  }: { headText: string; truncation: Omit<ReturnType<typeof truncateHead>, "content"> },
  {
    allLines,
    startLine,
    userLimitedLines,
  }: { allLines: readonly string[]; startLine: number; userLimitedLines: number | undefined },
  path: string,
) {
  const diagnostics: ToolDiagnostic[] = [];
  let outputText = headText;
  let details: object | undefined;
  const totalFileLines = allLines.length;
  const startLineDisplay = startLine + 1;
  if (truncation.firstLineExceedsLimit) {
    const lineBytes = new TextEncoder().encode(allLines[startLine]);
    const end = characterEnd(lineBytes, DEFAULT_MAX_BYTES);
    outputText = new TextDecoder().decode(lineBytes.subarray(0, end));
    diagnostics.push({
      severity: "warn",
      code: "truncated",
      message: `Line ${startLineDisplay} is ${formatSize(lineBytes.byteLength)}, exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit; showing its first ${formatSize(end)}. Use bash: sed -n '${startLineDisplay}p' ${path} | tail -c +${end + 1}`,
    });
    details = { truncation: { ...truncation, outputBytes: end, outputLines: 1 } };
  } else if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const nextOffset = endLineDisplay + 1;
    const limitText =
      truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    diagnostics.push({
      severity: "info",
      code: "truncated",
      message: `Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${nextOffset} to continue.`,
    });
    details = { truncation };
  } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    diagnostics.push({
      severity: "info",
      message: `${remaining} more lines in file. Use offset=${nextOffset} to continue.`,
    });
  }
  return { outputText, details, diagnostics };
}

function referenceRead(
  bytes: Uint8Array,
  path: string,
  offset: number | undefined,
  limit: number | undefined,
) {
  const mimeType = detectSupportedImageMimeType(bytes);
  if (mimeType !== undefined && mimeType !== "") {
    return {
      output: [{ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType }],
      diagnostics: [{ severity: "info", code: "image", message: `Read image file [${mimeType}].` }],
    };
  }
  const textContent = new TextDecoder().decode(bytes);
  const allLines = textContent.split("\n");
  const startLine = offset !== undefined && offset > 0 ? Math.max(0, offset - 1) : 0;
  if (startLine >= allLines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
  }
  const { selectedContent, userLimitedLines } = selectLines(allLines, startLine, limit);
  const { content: headText, ...truncation } = truncateHead(selectedContent);
  const { outputText, details, diagnostics } = truncationNotice(
    { headText, truncation },
    { allLines, startLine, userLimitedLines },
    path,
  );
  return {
    output: outputText === "" ? [] : [{ type: "text", text: outputText }],
    ...(details === undefined ? {} : { details }),
    diagnostics,
  };
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  [0x0a],
  [0x0a],
  [0x61],
  [0x62, 0x63, 0x64, 0x65],
  [0xef, 0xbb, 0xbf],
  [0xc3, 0xa9],
  [0xe2, 0x82, 0xac],
  [0xf0, 0x9f, 0x98, 0x80],
  [0xe2, 0x82],
  [0xff],
  [0x0d, 0x0a],
];

function randomFile(next: () => number): Uint8Array {
  const kind = next();
  if (kind < 0.1)
    return Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("x\n".repeat(2100))]);
  if (kind < 0.2) {
    const line = new Uint8Array(DEFAULT_MAX_BYTES + 200 + Math.floor(next() * 400)).fill(0x61);
    line[DEFAULT_MAX_BYTES - 1 + Math.floor(next() * 3)] = 0xc3;
    return Uint8Array.from([...line, 0x0a, 0x62]);
  }
  if (kind < 0.3) return new TextEncoder().encode(`${"0123456789".repeat(30)}\n`.repeat(200));
  const bytes: number[] = [];
  const pieces = Math.floor(next() * 80);
  for (let index = 0; index < pieces; index++)
    bytes.push(...PIECES[Math.floor(next() * PIECES.length)]!);
  return Uint8Array.from(bytes);
}

const OFFSETS = [undefined, 0, 1, 2, 3, 2.5, -4, 50, 2001, 3000, 1e20, Number.NaN];
const LIMITS = [undefined, 0, 1, 2, -3, -1e20, 1.5, 7, 2000, 2500, 1e20, Number.NaN];

function apiFor(env: NodeExecutionEnv): ToolExecutionApi {
  return {
    env,
    output: () => {},
    outputWindow: undefined,
    diagnostic: () => {},
    details: () => Promise.resolve(),
    agent: () => Promise.resolve({}),
  } as unknown as ToolExecutionApi;
}

const dirs: string[] = [];
afterAll(() => Effect.runPromise(removeDirs(dirs)));

const outcome = Effect.fn("outcome")(function* <T>(run: () => T | Promise<T>) {
  const exit = yield* Effect.exit(Effect.suspend(() => awaited(run())));
  return Exit.isSuccess(exit) ? exit.value : { error: (Cause.squash(exit.cause) as Error).message };
});

const returnsExactlyWhat = Effect.gen(function* () {
  const cwd = yield* makeTempDir("msa-durable-read-");
  dirs.push(cwd);
  const env = new NodeExecutionEnv({ cwd });
  const tool = createReadTool();
  for (const seed of Array.from({ length: 400 }, (_, i) => 1 + i)) {
    const next = random(seed);
    const file = randomFile(next);
    yield* writeTempFile(cwd, "f.txt", file);
    for (const _ of Array.from({ length: 4 })) {
      const offset = OFFSETS[Math.floor(next() * OFFSETS.length)];
      const limit = LIMITS[Math.floor(next() * LIMITS.length)];
      const args = {
        path: "f.txt",
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
      };
      const actual = yield* outcome(() => tool.execute(args, apiFor(env), BACKGROUND_CONTEXT));
      const expected = yield* outcome(() => referenceRead(file, "f.txt", offset, limit));
      expect(actual, `seed ${seed} offset ${offset} limit ${limit}`).toEqual(expected);
    }
  }
});

describe("read tool", () => {
  it(
    "returns exactly what reading the whole file returned",
    () => Effect.runPromise(returnsExactlyWhat),
    120_000,
  );
});

const detectsAnimatedPNGs = Effect.gen(function* () {
  const cwd = yield* makeTempDir("msa-durable-read-");
  dirs.push(cwd);
  const chunk = (type: string, length: number): number[] => [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...new TextEncoder().encode(type),
    ...new Array<number>(length + 4).fill(0),
  ];
  const png = Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", 13),
    ...chunk("iCCP", 200_000),
    ...chunk("acTL", 8),
    ...chunk("IDAT", 10),
  ]);
  yield* writeTempFile(cwd, "a.png", png);
  const env = new NodeExecutionEnv({ cwd });
  const actual = yield* outcome(() =>
    createReadTool().execute({ path: "a.png" }, apiFor(env), BACKGROUND_CONTEXT),
  );
  expect(actual).toEqual(yield* outcome(() => referenceRead(png, "a.png", undefined, undefined)));
});

describe("read tool", () => {
  it("detects animated PNGs whose acTL chunk lies far beyond the header", () =>
    Effect.runPromise(detectsAnimatedPNGs));
});
