import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import type { ToolExecutionResult } from "@msa/durable";
import { applyPatch } from "diff";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { detectSupportedImageMimeType } from "../src/tools/image.ts";
import { createEditTool, createReadTool, createWriteTool } from "../src/tools/index.ts";
import { appendTempFile } from "./temp-support.ts";
import {
  textOutput,
  createEnv,
  createTempDir,
  run,
  delay,
  BlockingWriteExecutionEnv,
  removeTempDirs,
} from "./tools-support.ts";

afterAll(removeTempDirs);

function diagnosticText(result: ToolExecutionResult): string {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.message).join("\n");
}

describe("durable tools", () => {
  it("fail with an ordinary error when no environment is configured", async () => {
    await expect(run(createReadTool(), { path: "x" }, undefined)).rejects.toThrow(
      "No execution environment",
    );
  });
});

describe("durable tools", () => {
  describe("read", () => {
    it.each(["GIF87a", "GIF89a"])("detects the complete %s signature", (signature) => {
      expect(detectSupportedImageMimeType(Buffer.from(signature, "ascii"))).toBe("image/gif");
    });

    it("reads text with offsets and limits and reports continuation as a diagnostic", async () => {
      const env = createEnv();
      getOrThrow(
        await env.writeFile(
          "test.txt",
          Array.from({ length: 100 }, (_, index) => `Line ${index + 1}`).join("\n"),
          BACKGROUND_CONTEXT,
        ),
      );
      const result = await run(createReadTool(), { path: "test.txt", offset: 41, limit: 20 }, env);
      const output = textOutput(result);
      expect(output).not.toContain("Line 40");
      expect(output).toContain("Line 41");
      expect(output).toContain("Line 60");
      expect(output).not.toContain("Line 61");
      expect(output).not.toContain("more lines");
      expect(diagnosticText(result)).toBe("40 more lines in file. Use offset=61 to continue.");
    });

    it("truncates large text by line count", async () => {
      const env = createEnv();
      getOrThrow(
        await env.writeFile(
          "large.txt",
          Array.from({ length: 2500 }, (_, index) => `Line ${index + 1}`).join("\n"),
          BACKGROUND_CONTEXT,
        ),
      );
      const result = await run(createReadTool(), { path: "large.txt" }, env);
      expect(diagnosticText(result)).toBe(
        "Showing lines 1-2000 of 2500. Use offset=2001 to continue.",
      );
      expect(result.diagnostics?.[0]?.code).toBe("truncated");
      expect((result.details as { truncation?: unknown } | undefined)?.truncation).toMatchObject({
        truncated: true,
        truncatedBy: "lines",
        totalLines: 2500,
        outputLines: 2000,
      });
    });
  });
});

describe("durable tools", () => {
  describe("read", () => {
    it("does not count a trailing newline as an extra line at the truncation limit", async () => {
      const env = createEnv();
      getOrThrow(
        await env.writeFile(
          "exact.txt",
          `${Array.from({ length: 2000 }, () => "x").join("\n")}\n`,
          BACKGROUND_CONTEXT,
        ),
      );
      const result = await run(createReadTool(), { path: "exact.txt" }, env);
      expect(result.details).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    });

    it("shows the start of a line longer than the byte limit", async () => {
      const env = createEnv();
      getOrThrow(
        await env.writeFile("long.txt", `${"é".repeat(40_000)}\nnext\n`, BACKGROUND_CONTEXT),
      );
      const result = await run(createReadTool(), { path: "long.txt" }, env);
      const text = textOutput(result);
      // Two-byte characters: the cut lands on a character boundary at or below the limit.
      expect(text).toBe("é".repeat(25_600));
      expect(diagnosticText(result)).toBe(
        "Line 1 is 78.1KB, exceeds the 50.0KB limit; showing its first 50.0KB. Use bash: sed -n '1p' long.txt | tail -c +51201",
      );
      expect((result.details as { truncation: object }).truncation).toMatchObject({
        truncated: true,
        firstLineExceedsLimit: true,
        outputBytes: 51_200,
        outputLines: 1,
      });
      expect(result.details).not.toHaveProperty("truncation.content");
    });

    it("rejects offsets beyond the file", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("short.txt", "one\ntwo\nthree", BACKGROUND_CONTEXT));
      await expect(run(createReadTool(), { path: "short.txt", offset: 100 }, env)).rejects.toThrow(
        "Offset 100 is beyond end of file (3 lines total)",
      );
    });
  });
});

describe("durable tools", () => {
  describe("read", () => {
    it("reads a log that grows while it is read", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("app.log", "one\ntwo\n", BACKGROUND_CONTEXT));
      // Every read appends, as a busy writer would; the scanned lines stay as they were.
      const growing = Object.create(env) as NodeExecutionEnv;
      growing.openBinaryReader = async (path, options, context) => {
        const opened = await env.openBinaryReader(path, options, context);
        if (!opened.ok) return opened;
        const reader = opened.value;
        const read = reader.read.bind(reader);
        reader.read = (position, length, readContext) => {
          appendTempFile(env.cwd, "app.log", "more\n");
          return Promise.resolve(read(position, length, readContext));
        };
        return opened;
      };
      const result = await run(createReadTool(), { path: "app.log", limit: 2 }, growing);
      expect(textOutput(result)).toBe("one\ntwo");
    });

    it("returns images by content as one image block", async () => {
      const env = createEnv();
      const data =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
      getOrThrow(
        await env.writeFile(
          "image.txt",
          Uint8Array.from(Buffer.from(data, "base64")),
          BACKGROUND_CONTEXT,
        ),
      );
      const result = await run(createReadTool(), { path: "image.txt" }, env);
      expect(result.output).toEqual([{ type: "image", data, mimeType: "image/png" }]);
      expect(result.isError).toBeUndefined();
      expect(diagnosticText(result)).toBe("Read image file [image/png].");
    });
  });
});

describe("durable tools", () => {
  describe("write", () => {
    it("writes files and creates parent directories", async () => {
      const env = createEnv();
      const result = await run(
        createWriteTool(),
        { path: "nested/dir/file.txt", content: "hello" },
        env,
      );
      expect(textOutput(result)).toBe("Successfully wrote to nested/dir/file.txt");
      expect(getOrThrow(await env.readTextFile("nested/dir/file.txt", BACKGROUND_CONTEXT))).toBe(
        "hello",
      );
    });

    it("keeps the mutation queue locked until an aborted write settles", async () => {
      const env = new BlockingWriteExecutionEnv({ cwd: createTempDir() });
      const tool = createWriteTool();
      const controller = new AbortController();
      const firstWrite = run(
        tool,
        { path: "file.txt", content: "first\n" },
        env,
        withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
      );
      await env.firstWriteStarted.promise;
      controller.abort();
      const secondWrite = run(tool, { path: "file.txt", content: "second\n" }, env);
      await delay(20);
      expect(env.secondWriteStarted).toBe(false);
      env.finishFirstWrite.resolve();
      await expect(firstWrite).rejects.toThrow();
      await secondWrite;
      expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("second\n");
    });
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it("applies disjoint edits and returns both diff formats", async () => {
      const env = createEnv();
      const original = "alpha\nbeta\ngamma\ndelta\n";
      getOrThrow(await env.writeFile("edit.txt", original, BACKGROUND_CONTEXT));
      const result = await run(
        createEditTool(),
        {
          path: "edit.txt",
          edits: [
            { oldText: "alpha\n", newText: "ALPHA\n" },
            { oldText: "gamma\n", newText: "GAMMA\n" },
          ],
        },
        env,
      );
      const details = result.details as { diff: string; patch: string };
      expect(textOutput(result)).toBe("Successfully replaced 2 block(s) in edit.txt.");
      expect(details.diff).toContain("ALPHA");
      expect(details.diff).toContain("GAMMA");
      expect(applyPatch(original, details.patch)).toBe("ALPHA\nbeta\nGAMMA\ndelta\n");
      expect(getOrThrow(await env.readTextFile("edit.txt", BACKGROUND_CONTEXT))).toBe(
        "ALPHA\nbeta\nGAMMA\ndelta\n",
      );
    });

    it("repairs edits sent as a JSON string, a single object, or top-level oldText/newText without mutating them", () => {
      const prepare = createEditTool().prepareArguments!;
      const edit = { oldText: "a", newText: "b" };
      const asString = { path: "f", edits: JSON.stringify([edit]) };
      expect(prepare(asString)).toEqual({ path: "f", edits: [edit] });
      expect(asString.edits).toBe(JSON.stringify([edit]));
      expect(prepare({ path: "f", edits: JSON.stringify(edit) })).toEqual({
        path: "f",
        edits: [edit],
      });
      expect(prepare({ path: "f", edits: edit })).toEqual({ path: "f", edits: [edit] });
      expect(prepare({ path: "f", edits: [edit], oldText: "c", newText: "d" })).toEqual({
        path: "f",
        edits: [edit, { oldText: "c", newText: "d" }],
      });
      expect(prepare({ path: "f", edits: "not json" })).toEqual({ path: "f", edits: "not json" });
    });
  });
});
