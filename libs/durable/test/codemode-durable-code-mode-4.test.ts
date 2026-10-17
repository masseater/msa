import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { codemodeChat, tool } from "./codemode-chat-support.ts";
import { directories, runScript } from "./codemode-support.ts";
import { addTool } from "./harness-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("durable code mode output and tool search", () => {
  it("finds tools with searchTools(), describeTool(), and describeNamespace(), and lists them in ALL_TOOLS", async () => {
    const chat = codemodeChat(
      [],
      [{ name: "github", description: "GitHub MCP server", prefix: "mcp__github__" }],
    );
    addTool(
      chat.setup.registry,
      tool("mcp__github__list_issues", () => Promise.resolve({ output: [] })),
    );
    const { text } = await runScript(
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
      JSON.parse(text.replace(/^Script completed\nWall time [\d.]+ seconds\nOutput:\n/u, "")),
    ).toEqual({
      found: ["mcp__github__list_issues"],
      inNamespace: [],
      described: true,
      missing: null,
      namespace: {
        name: "github",
        description: "GitHub MCP server",
        tools: ["mcp__github__list_issues"],
      },
      all: true,
    });
  });
});
