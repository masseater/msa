import { mkdirSync } from "node:fs";
import { symlink } from "node:fs/promises";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { withFileMutationQueue } from "../src/tools/env.ts";
import { createEditTool, createWriteTool } from "../src/tools/index.ts";
import { BlockingEditExecutionEnv } from "./tools-blocking-edit-env-support.ts";
import { SlowReadExecutionEnv } from "./tools-slow-read-env-support.ts";
import {
  BlockingWriteExecutionEnv,
  createEnv,
  createTempDir,
  deferred,
  delay,
  removeTempDirs,
  run,
} from "./tools-support.ts";

afterAll(removeTempDirs);

describe("durable tools", () => {
  describe("edit", () => {
    it("matches all edits against the original and rejects overlaps", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("edit.txt", "one\ntwo\nthree\n", BACKGROUND_CONTEXT));
      await expect(
        run(
          createEditTool(),
          {
            path: "edit.txt",
            edits: [
              { oldText: "one\ntwo\n", newText: "ONE\nTWO\n" },
              { oldText: "two\nthree\n", newText: "TWO\nTHREE\n" },
            ],
          },
          env,
        ),
      ).rejects.toThrow(/overlap/u);
      expect(getOrThrow(await env.readTextFile("edit.txt", BACKGROUND_CONTEXT))).toBe(
        "one\ntwo\nthree\n",
      );
    });

    it("rejects missing and duplicate target text", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("edit.txt", "foo foo foo", BACKGROUND_CONTEXT));
      const tool = createEditTool();
      await expect(
        run(tool, { path: "edit.txt", edits: [{ oldText: "bar", newText: "baz" }] }, env),
      ).rejects.toThrow(/Could not find the exact text/u);
      await expect(
        run(tool, { path: "edit.txt", edits: [{ oldText: "foo", newText: "bar" }] }, env),
      ).rejects.toThrow(/Found 3 occurrences/u);
    });
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it("keeps the mutation queue locked until an aborted edit write settles", async () => {
      const env = new BlockingEditExecutionEnv({ cwd: createTempDir() });
      getOrThrow(await env.writeFile("file.txt", "alpha\nbeta\n", BACKGROUND_CONTEXT));
      const tool = createEditTool();
      const controller = new AbortController();
      const firstEdit = run(
        tool,
        { path: "file.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] },
        env,
        withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
      );
      await env.firstEditWriteStarted.promise;
      controller.abort();
      const secondEdit = run(
        tool,
        { path: "file.txt", edits: [{ oldText: "beta", newText: "BETA" }] },
        env,
      );
      await delay(20);
      expect(env.secondEditWriteStarted).toBe(false);
      env.finishFirstEditWrite.resolve();
      await expect(firstEdit).rejects.toThrow("Operation aborted");
      await secondEdit;
      expect(env.firstEditWriteSettled).toBe(true);
      expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe(
        "ALPHA\nBETA\n",
      );
    });

    it("serializes concurrent edits through canonical and symlink paths", async () => {
      const env = new SlowReadExecutionEnv({ cwd: createTempDir() });
      getOrThrow(await env.writeFile("target.txt", "alpha\nbeta\ngamma\n", BACKGROUND_CONTEXT));
      await symlink("target.txt", `${env.cwd}/link.txt`);
      const tool = createEditTool();
      await Promise.all([
        run(tool, { path: "target.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, env),
        run(tool, { path: "link.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, env),
      ]);
      expect(getOrThrow(await env.readTextFile("target.txt", BACKGROUND_CONTEXT))).toBe(
        "ALPHA\nBETA\ngamma\n",
      );
    });
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it("serializes edits of one file across environment objects of one file system", async () => {
      const dir = createTempDir();
      const first = new SlowReadExecutionEnv({ cwd: dir });
      const second = new SlowReadExecutionEnv({ cwd: dir });
      getOrThrow(await first.writeFile("file.txt", "alpha\nbeta\n", BACKGROUND_CONTEXT));
      const tool = createEditTool();
      await Promise.all([
        run(tool, { path: "file.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, first),
        run(tool, { path: "file.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, second),
      ]);
      expect(getOrThrow(await first.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe(
        "ALPHA\nBETA\n",
      );
    });

    it("serializes a new file created through a symlinked directory with its canonical path", async () => {
      const env = new BlockingWriteExecutionEnv({ cwd: createTempDir() });
      mkdirSync(`${env.cwd}/real`);
      await symlink(`${env.cwd}/real`, `${env.cwd}/link`);
      const tool = createWriteTool();
      const first = run(tool, { path: "link/new.txt", content: "first\n" }, env);
      await env.firstWriteStarted.promise;
      const second = run(tool, { path: "real/new.txt", content: "second\n" }, env);
      await delay(20);
      expect(env.secondWriteStarted).toBe(false);
      env.finishFirstWrite.resolve();
      await Promise.all([first, second]);
      expect(getOrThrow(await env.readTextFile("real/new.txt", BACKGROUND_CONTEXT))).toBe(
        "second\n",
      );
    });
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it.skipIf(process.platform === "win32")(
      "keys a missing file whose name contains a backslash like the created file",
      async () => {
        const env = createEnv();
        const created = deferred();
        const release = deferred();
        const first = withFileMutationQueue(
          env,
          "a\\b.txt",
          async () => {
            getOrThrow(await env.writeFile("a\\b.txt", "first\n", BACKGROUND_CONTEXT));
            created.resolve();
            await release.promise;
          },
          BACKGROUND_CONTEXT,
        );
        await created.promise;
        let entered = false;
        const second = withFileMutationQueue(
          env,
          "a\\b.txt",
          () => {
            entered = true;

            return Promise.resolve();
          },
          BACKGROUND_CONTEXT,
        );
        await delay(20);
        expect(entered).toBe(false);
        release.resolve();
        await Promise.all([first, second]);
        expect(entered).toBe(true);
      },
    );
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it("does not serialize the same path on different file systems", async () => {
      class OtherFileSystem extends BlockingWriteExecutionEnv {
        override readonly id = "other";
      }
      const dir = createTempDir();
      const local = new BlockingWriteExecutionEnv({ cwd: dir });
      const other = new OtherFileSystem({ cwd: dir });
      const tool = createWriteTool();
      const blocked = run(tool, { path: "file.txt", content: "first\n" }, local);
      await local.firstWriteStarted.promise;
      await run(tool, { path: "file.txt", content: "second\n" }, other);
      expect(other.secondWriteStarted).toBe(true);
      local.finishFirstWrite.resolve();
      await blocked;
    });

    it("edits regular files through symlinks", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("target.txt", "before\n", BACKGROUND_CONTEXT));
      await symlink("target.txt", `${env.cwd}/link.txt`);
      await run(
        createEditTool(),
        { path: "link.txt", edits: [{ oldText: "before", newText: "after" }] },
        env,
      );
      expect(getOrThrow(await env.readTextFile("target.txt", BACKGROUND_CONTEXT))).toBe("after\n");
    });

    it("preserves BOM and CRLF line endings", async () => {
      const env = createEnv();
      getOrThrow(await env.writeFile("edit.txt", "\uFEFFone\r\ntwo\r\n", BACKGROUND_CONTEXT));
      await run(
        createEditTool(),
        { path: "edit.txt", edits: [{ oldText: "two", newText: "TWO" }] },
        env,
      );
      expect(getOrThrow(await env.readTextFile("edit.txt", BACKGROUND_CONTEXT))).toBe(
        "\uFEFFone\r\nTWO\r\n",
      );
    });
  });
});
