import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  dependenciesAvailable,
  exec,
  fixtures,
  readClipboard,
  startServer,
  startX11,
} from "./native-clipboard-linux-helpers.ts";

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases8();
});

function nativeLinuxClipboardCases8(): void {
  let directory: string;
  before(() => {
    directory = mkdtempSync(join(tmpdir(), "msa-clipboard-test-"));
    const flags = [
      "-std=c11",
      "-D_POSIX_C_SOURCE=200809L",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pthread",
    ];
    execFileSync("cc", [
      ...flags,
      join(fixtures, "clipboard-x11-test.c"),
      "-lxcb",
      "-ldl",
      "-o",
      join(directory, "x11-test"),
    ]);
    execFileSync("cc", [
      ...flags,
      "-shared",
      "-fPIC",
      "-nostdlib",
      ...(process.arch === "arm64" ? ["-mno-outline-atomics"] : []),
      "-Wl,-z,nodelete",
      join(fixtures, "clipboard-worker-test.c"),
      "-ldl",
      "-o",
      join(directory, "worker-test.node"),
    ]);
  });
  after(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  ["text", "image"].forEach((content) => {
    it(`frees partially received X11 ${content} after invalid metadata`, async (t) => {
      const { env } = await startX11(t);
      await startServer(t, join(directory, "x11-test"), ["invalid"], env);
      const { stdout } = await exec(join(directory, "x11-test"), [content], { env, timeout: 6000 });
      assert.equal(stdout.trim(), "clean");
    });

    it(`times out stalled X11 ${content} after a partial transfer without blocking JS`, async (t) => {
      const { env } = await startX11(t);
      await startServer(t, join(directory, "x11-test"), ["partial"], env);
      const started = performance.now();
      const result = await readClipboard(content === "text" ? "getText" : "getImage", env);
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /X11 clipboard/u);
      assert.ok(performance.now() - started < 3500);
    });
  });
}
