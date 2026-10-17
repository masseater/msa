import { readFile } from "node:fs/promises";

import { Type } from "@msa/ai";
import { defineTool } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { codemodeChat } from "./codemode-chat-support.ts";
import { runScript, removeDirectories } from "./codemode-support.ts";
import { addTool } from "./harness-support.ts";

afterEach(removeDirectories);

describe("durable code mode output and tool search", () => {
  it("lays out text items, console lines, and the returned value under a header", async () => {
    const { text } = await runScript(
      `text("one"); console.log("log", 1); text({ two: 2 }); return "three";`,
    );
    expect(text).toMatch(/^Script completed\nWall time [\d.]+ seconds\nOutput:\n/u);
    expect(text).toContain(
      '==> text 1/3 <==\none\n==> text 2/3 <==\n{"two":2}\n==> text 3/3 <==\nthree',
    );
    expect(text).toContain("<console_output>\nlog 1\n</console_output>");
  });

  it("cuts text past the token budget to its start and end, with the full text in a file", async () => {
    const { text, message } = await runScript(
      `// @options: {"max_output_tokens": 20}
			text("BEGIN" + "x".repeat(1000) + "END");`,
    );
    expect(text).toContain("Warning: truncated output");
    expect(text).toContain("BEGIN");
    expect(text).toContain("END");
    const path = message.details?.fullOutputPath;
    expect(text).toContain(`[Full output: ${path}`);
    expect(await readFile(path!, "utf8")).toBe(`BEGIN${"x".repeat(1000)}END`);
  });

  it("keeps a result inside the tool's output limits whatever max_output_tokens says, spilling the rest", async () => {
    // 6 MiB of text: over the Harness's 4 MiB limit, which would cut it without a spill file.
    const big = await runScript(
      `// @options: {"max_output_tokens": 2000000}
			return "x".repeat(6 * 1024 * 1024);`,
    );
    expect(big.text).toContain("Warning: truncated output");
    expect(big.text.length).toBeLessThanOrEqual(1024 * 1024 + 1000);
    expect((await readFile(big.message.details!.fullOutputPath!, "utf8")).length).toBe(
      6 * 1024 * 1024,
    );
    // 200,000 short lines: within the byte limit, over the 100,000 lines one.
    const long = await runScript(
      `// @options: {"max_output_tokens": 2000000}
			return Array.from({ length: 200000 }, () => "a").join("\\n");`,
    );
    expect(long.text).toContain("Warning: truncated output");
    expect(long.text.split("\n").length).toBeLessThan(100_000);
    expect(long.message.details?.fullOutputPath).toBeDefined();
  });
});

describe("durable code mode output and tool search", () => {
  it("saves images to files and names them next to the image", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const { text, message } = await runScript(`image("data:image/png;base64,${png}");`);
    const saved = /\[Image saved to (\S+) \(image\/png, \d+ bytes\)\]/u.exec(text);
    expect(saved).not.toBeNull();
    expect((await readFile(saved![1]!)).toString("base64")).toBe(png);
    expect(message.content.some((item) => item.type === "image")).toBe(true);
  });

  it("calls a deferred tool the model is not offered, and finds it in ALL_TOOLS", async () => {
    const chat = codemodeChat();
    addTool(
      chat.setup.registry,
      defineTool({
        name: "later",
        description: "A deferred tool",
        parameters: Type.Object({}),
        deferred: true,
        execute: () => Promise.resolve({ output: [{ type: "text", text: "later ran" }] }),
      }),
    );
    const { text } = await runScript(
      `return [await tools.later({}), ALL_TOOLS.some((tool) => tool.name === "later")];`,
      chat,
    );
    expect(text).toContain('["later ran",true]');
  });

  it("reports a failed script with its error and the calls already made", async () => {
    const { text, message } = await runScript(
      `await tools.echo({ text: "a" }); throw new Error("boom");`,
    );
    expect(message.isError).toBe(true);
    expect(text).toMatch(/^Script failed\n/u);
    expect(text).toContain("Error: boom");
    expect(text).toContain("Tool calls made before the failure (they are not undone): echo (ok)");
  });
});
