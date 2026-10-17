import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  dependenciesAvailable,
  fixtures,
  readClipboard,
  startServer,
  startX11,
} from "./native-clipboard-linux-helpers.ts";

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases4();
});

function nativeLinuxClipboardCases4(): void {
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
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });
  it("reads UTF8_STRING when X11 TARGETS is refused", async (t) => {
    const { env } = await startX11(t);
    await startServer(t, join(directory, "x11-test"), ["direct-text"], env);
    const result = await readClipboard("getText", env);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.value, "café 日本語");
  });
}

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases5();
});

function nativeLinuxClipboardCases5(): void {
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
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });
  it("returns null for empty X11 clipboards and text-only selections", async (t) => {
    const { env } = await startX11(t);
    assert.deepEqual(await readClipboard("getText", env), { ok: true, value: null });
    assert.deepEqual(await readClipboard("getImage", env), { ok: true, value: null });
    execFileSync("xclip", ["-selection", "clipboard", "-in", "-t", "UTF8_STRING"], {
      env,
      input: "text only",
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 5000,
    });
    assert.deepEqual(await readClipboard("getImage", env), { ok: true, value: null });
  });
}

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases6();
});

function nativeLinuxClipboardCases6(): void {
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
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });
  it("preserves X11 Unicode and incremental text/image transfers", async (t) => {
    const { env } = await startX11(t);
    for await (const [target, method, bytes] of [
      ["UTF8_STRING", "getText", Buffer.from("café 日本語")],
      ["UTF8_STRING", "getText", Buffer.alloc(4 * 1024 * 1024, 120)],
      ["image/png", "getImage", Buffer.alloc(4 * 1024 * 1024, 123)],
    ] as const) {
      execFileSync("xclip", ["-selection", "clipboard", "-in", "-t", target], {
        env,
        input: bytes,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 5000,
      });
      const result = await readClipboard(method, env);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.length, bytes.length);
      assert.equal(result.hash, createHash("sha256").update(bytes).digest("hex"));
    }
  });
}

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases7();
});

function nativeLinuxClipboardCases7(): void {
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
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });
  ["disconnect", "timeout"].forEach((mode) => {
    it(`reports X11 transfer ${mode} as an exception, not an unavailable display`, async (t) => {
      const { child, env } = await startX11(t);
      const owner = await startServer(t, join(directory, "x11-test"), ["idle"], env);
      const requested = once(owner.child.stdout, "data");
      const started = performance.now();
      const result = readClipboard("getText", env);
      await requested;
      if (mode === "disconnect") child.kill("SIGKILL");
      const failure = await result;
      assert.equal(failure.ok, false);
      assert.match(failure.error ?? "", /X11 clipboard/u);
      assert.ok(
        performance.now() - started < 3500,
        "The transfer must share the 2-second deadline",
      );
    });
  });
}
