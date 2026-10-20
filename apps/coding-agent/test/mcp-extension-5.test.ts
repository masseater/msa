import { describe, expect, it } from "vite-plus/test";

import { MAX_SERVERS_SECTION_CHARS, renderServersSection } from "../src/extensions/mcp/index.ts";

const server2 = (
  name: string,
  description?: string,
  exposure?: "codemode" | "deferred" | "direct",
) => ({
  entry: {
    config: {
      command: "x",
      ...(description !== undefined && description.length > 0 ? { description } : {}),
      ...(exposure !== undefined && exposure.length > 0 ? { exposure } : {}),
    },
    name,
    source: "test",
  },
});

const shortensDescriptionsToFitTheSizeLimit = () => {
  const servers = Array.from({ length: 40 }, (_, index) =>
    server2(`server${index}`, "x".repeat(400)),
  );
  const section = renderServersSection(servers) ?? "";
  expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
  expect(section.split("\n")).toHaveLength(41);
  expect(section).toContain("- mcp__server39 (codemode): x");
};

const leavesOutTheLastServersWhenTheir = () => {
  const servers = Array.from({ length: 200 }, (_, index) =>
    server2(`server-with-a-long-name-${index}`, "desc"),
  );
  const section = renderServersSection(servers) ?? "";
  expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
  const lines = section.split("\n");
  expect(lines.at(-1)).toMatch(/^- … \d+ more servers; find their tools with searchTools\(\)$/u);
  const omitted = Number(/(\d+) more/u.exec(lines.at(-1) ?? "")?.[1]);
  expect(lines.length - 2 + omitted).toBe(200);
};

describe("MCP servers section", () => {
  it("lists servers with how their tools are reached and the first line of their description", () => {
    const section = renderServersSection([
      server2("docs", "Docs search.\nMore."),
      server2("later", undefined, "deferred"),
      server2("direct", "Declared.", "direct"),
      { connection: { instructions: "From instructions." }, entry: server2("plain").entry },
    ]);
    expect(section?.split("\n").slice(1)).toEqual([
      "- mcp__docs (codemode): Docs search.",
      "- mcp__later (tool_search)",
      "- mcp__plain (codemode): From instructions.",
    ]);
    expect(renderServersSection([server2("direct", "Declared.", "direct")])).toBeUndefined();
  });

  it("shortens descriptions to fit the size limit", shortensDescriptionsToFitTheSizeLimit);

  it(
    "leaves out the last servers when their names alone do not fit",
    leavesOutTheLastServersWhenTheir,
  );
});
