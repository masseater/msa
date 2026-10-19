import { type AssistantMessage, fauxAssistantMessage, fauxText, Type } from "@msa/ai";
import { CodemodeSandbox } from "@msa/codemode";
import { CODEMODE_SOURCE_GRAMMAR } from "@msa/codemode/source";
import { defineTool, type ToolRegistration } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createCodemodeExtension } from "../src/codemode/codemode.ts";
import {
  type CodemodeNamespace,
  codemodeDescription,
  codemodeSection,
} from "../src/codemode/describe.ts";
import { allEntries, chatSetup, openChat, awaited, context } from "./support.ts";

function tool(
  name: string,
  description: string,
  extra: Partial<ToolRegistration> = {},
): ToolRegistration {
  return defineTool({
    name,
    description,
    parameters: Type.Object({ path: Type.String({ description: "File path" }) }),
    execute: () => Promise.resolve({ output: [] }),
    ...extra,
  });
}

const GITHUB: CodemodeNamespace = {
  name: "github",
  description: "GitHub MCP server",
  prefix: "mcp__github__",
};

describe("code mode description and section", () => {
  it("keeps the tool description the same for every conversation", () => {
    const text = codemodeDescription(false);
    expect(text).toContain("`await tools.<name>({ ...args })`");
    expect(text).toContain("searchTools(query");
    expect(text).toContain(
      "The `codemode` section of the system prompt lists the tools scripts can call",
    );
    expect(text).not.toContain("`models`");
    expect(codemodeDescription(true)).toContain("`models`");
  });

  it("lists callable tools as declarations, grouped by namespace, with namespace descriptions", () => {
    const section = codemodeSection(
      [tool("read", "Read a file."), tool("mcp__github__list_issues", "List issues.")],
      [GITHUB],
      3000,
    )!;
    expect(section).toContain("### `read`\nRead a file.");
    expect(section).toContain("read(args: {");
    expect(section).toContain("## github\nGitHub MCP server");
    expect(section.indexOf("### `read`")).toBeLessThan(section.indexOf("## github"));
    expect(section.indexOf("## github")).toBeLessThan(
      section.indexOf("### `mcp__github__list_issues`"),
    );
    expect(section).toContain("Promise<string>");
  });

  it("lists what fits the budget, every namespace before any is complete, and says what is left out", () => {
    const github = Array.from({ length: 30 }, (_, index) =>
      tool(`mcp__github__tool${index}`, "x".repeat(200)),
    );
    const section = codemodeSection([tool("read", "Read a file."), ...github], [GITHUB], 400)!;
    expect(section).toContain("### `read`");
    expect(section).toContain("## github (some tools not listed)");
    expect(section).not.toContain("tool29");
    expect(codemodeSection([...github], [GITHUB], 10)!).toContain("## github (tools not listed)");
    expect(codemodeSection([], [GITHUB], 3000)).toBeUndefined();
  });
});

const rendersSectionConversation = Effect.gen(function* () {
  const setup = chatSetup();
  setup.registry.install(
    createCodemodeExtension({ sandbox: new CodemodeSandbox(), namespaces: [GITHUB] }),
  );
  setup.registry.install({
    name: "tools",
    tools: [
      tool("read", "Read a file."),
      tool("mcp__github__list_issues", "List issues.", { callers: ["tools"] }),
      tool("mcp__github__get_issue", "Get an issue.", { deferred: true }),
    ],
  });
  setup.faux.setResponses([fauxAssistantMessage([fauxText("hi")]) as AssistantMessage]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const system = (yield* allEntries(root)).find((entry) => entry.kind === "msa.system")!;
  const sections = (system.model![0] as { sections?: Record<string, string> }).sections!;
  expect(sections["codemode"]).toContain("### `read`");
  expect(sections["codemode"]).toContain("### `mcp__github__list_issues`");
  expect(sections["codemode"]).not.toContain("mcp__github__get_issue");
  expect(sections["codemode"]).not.toContain("### `codemode`");
  const tools = (
    system.model![0] as { toolsAdded?: { name: string; constrainedSampling?: unknown }[] }
  ).toolsAdded!;
  expect(tools.find((candidate) => candidate.name === "codemode")?.constrainedSampling).toEqual({
    type: "grammar",
    variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR },
  });
  yield* awaited(harness.close(context));
});

describe("code mode description and section", () => {
  it("uses the longest matching namespace prefix", () => {
    const section = codemodeSection(
      [tool("mcp__github__x", "x")],
      [{ name: "git", prefix: "mcp__git" }, GITHUB],
      3000,
    )!;
    expect(section).toContain("## github");
    expect(section).not.toContain("## git\n");
  });

  it("renders the section from the conversation's callable tools into the system prompt", () =>
    Effect.runPromise(rendersSectionConversation));
});
