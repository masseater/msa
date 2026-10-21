import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import codemodeChatSupport from "./codemode-chat-support.ts";
import codemodeSupport from "./codemode-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import platformSupport from "./platform-support.ts";

const { codemodeChat, tool } = codemodeChatSupport;
const { directories, runScript } = codemodeSupport;
const { fromJsonText } = effectSupport;
const { addTool } = harnessSupport;
const { removeDir } = platformSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const findsToolsSearchTools = Effect.gen(function* () {
  const chat = codemodeChat({
    globals: [],
    namespaces: [{ description: "GitHub MCP server", name: "github", prefix: "mcp__github__" }],
  });
  addTool(
    chat.setup.registry,
    tool("mcp__github__list_issues", () => Promise.resolve({ output: [] })),
  );
  const { text } = yield* runScript(
    `const found = await searchTools("issues");
			const inNamespace = await searchTools("echo", { namespace: "github" });
			return {
				found: found.map((tool) => tool.name),
				inNamespace,
				described: (await describeTool("echo")).includes("echo(args:"),
				missing: (await describeTool("nope")) ?? null,
				namespace: await describeNamespace("github"),
				all: ALL_TOOLS.map((tool) => tool.name).includes("mcp__github__list_issues"),
			};`,
    chat,
  );
  expect(
    yield* fromJsonText(
      text.replace(/^Script completed\nWall time [\d.]+ seconds\nOutput:\n/u, ""),
    ),
  ).toEqual({
    all: true,
    described: true,
    found: ["mcp__github__list_issues"],
    inNamespace: [],
    missing: null,
    namespace: {
      description: "GitHub MCP server",
      name: "github",
      tools: ["mcp__github__list_issues"],
    },
  });
});

describe("durable code mode output and tool search", () => {
  it("finds tools with searchTools(), describeTool(), and describeNamespace(), and lists them in ALL_TOOLS", () =>
    Effect.runPromise(findsToolsSearchTools));
});
