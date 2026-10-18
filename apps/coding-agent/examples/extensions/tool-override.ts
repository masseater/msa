import { DateTime, Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";

import { NodeServices } from "@effect/platform-node";

import type { TextContent } from "@msa/ai";
import { type ExtensionAPI, getAgentDir } from "@msa/coding-agent";
import { Type } from "typebox";

const runtime = ManagedRuntime.make(NodeServices.layer);

const logPath = runtime.runSync(Path.Path);
const LOG_FILE = logPath.join(getAgentDir(), "read-access.log");

const BLOCKED_PATTERNS = [
  /\.env$/u,
  /\.env\..+$/u,
  /secrets?\.(json|yaml|yml|toml)$/iu,
  /credentials?\.(json|yaml|yml|toml)$/iu,
  /\/\.ssh\//u,
  /\/\.aws\//u,
  /\/\.gnupg\//u,
];

const isBlockedPath = (path: string): boolean =>
  BLOCKED_PATTERNS.some((pattern) => pattern.test(path));

const logAccess = (path: string, allowed: boolean, reason?: string) =>
  Effect.gen(function* () {
    const timestamp = DateTime.formatIso(DateTime.nowUnsafe());
    const status = allowed ? "ALLOWED" : "BLOCKED";
    const msg = reason !== undefined && reason.length > 0 ? ` (${reason})` : "";
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(LOG_FILE, `[${timestamp}] ${status}: ${path}${msg}\n`, {
      flag: "a",
    });
  }).pipe(Effect.ignore);

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const selectLines = (
  content: string,
  offset: number | undefined,
  limit: number | undefined,
): { text: string; lineCount: number } => {
  const lines = content.split("\n");
  const startLine = offset === undefined ? 0 : Math.max(0, offset - 1);
  const endLine = limit === undefined ? lines.length : startLine + limit;
  let text = lines.slice(startLine, endLine).join("\n");
  const maxBytes = 50 * 1024;
  if (Buffer.byteLength(text, "utf-8") > maxBytes) {
    text = `${text.slice(0, maxBytes)}\n\n[Output truncated at 50KB]`;
  }
  return { text, lineCount: lines.length };
};

const blockedResult = (path: string) => ({
  content: [
    {
      type: "text",
      text: `Access denied: "${path}" matches a blocked pattern (sensitive file). This tool blocks access to .env files, secrets, credentials, and SSH/AWS/GPG directories.`,
    },
  ] as TextContent[],
  details: { blocked: true },
});

const errorResult = (message: string) => ({
  content: [{ type: "text", text: `Error reading file: ${message}` }] as TextContent[],
  details: { error: true },
});

const readAudited = (
  cwd: string,
  params: { path: string; offset?: number | undefined; limit?: number | undefined },
) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const absolutePath = pathService.resolve(cwd, params.path);

    if (isBlockedPath(absolutePath)) {
      yield* logAccess(absolutePath, false, "matches blocked pattern");
      return blockedResult(params.path);
    }

    yield* logAccess(absolutePath, true);

    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(absolutePath).pipe(Effect.option);
    if (Option.isNone(content)) {
      return errorResult("could not read the file");
    }

    const { text, lineCount } = selectLines(content.value, params.offset, params.limit);
    return {
      content: [{ type: "text", text }] as TextContent[],
      details: { lines: lineCount },
    };
  });

export default function (msa: ExtensionAPI) {
  msa.registerTool({
    name: "read",
    label: "read (audited)",
    description:
      "Read the contents of a file with access logging. Some sensitive paths (.env, secrets, credentials) are blocked.",
    parameters: readSchema,

    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runtime.runPromise(readAudited(ctx.cwd, params)),
  });

  msa.registerCommand("read-log", {
    description: "View the file access log",
    handler: (_args, ctx) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const content = yield* fs.readFileString(LOG_FILE).pipe(Effect.option);
          if (Option.isNone(content) || content.value.trim().length === 0) {
            ctx.ui.notify("No access log found", "info");
            return;
          }
          const lines = content.value.trim().split("\n").slice(-20);
          ctx.ui.notify(`Recent file access:\n${lines.join("\n")}`, "info");
        }),
      ),
  });
}
