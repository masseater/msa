import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  dependenciesAvailable,
  exec,
  fixtures,
  readClipboard,
  startX11,
} from "./native-clipboard-linux-helpers.ts";

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
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
      // Match the prebuild's unversioned system-library imports.
      "-nostdlib",
      // Inline the fixture's allocation counters.
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
  it("validates X11 incremental property metadata before accumulating bytes", () => {
    assert.equal(
      execFileSync(join(directory, "x11-test"), ["metadata"], { encoding: "utf8" }).trim(),
      "validated",
    );
  });
});

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases1();
});

function nativeLinuxClipboardCases1(): void {
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
      // Match the prebuild's unversioned system-library imports.
      "-nostdlib",
      // Inline the fixture's allocation counters.
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
  ["concurrent", "process-exit", "worker-exit"].forEach((mode) => {
    it(`bounds private clipboard work and preserves cleanup: ${mode}`, async () => {
      const { stdout } = await exec(
        process.execPath,
        [join(fixtures, "clipboard-worker-test.cjs"), join(directory, "worker-test.node"), mode],
        { env: { ...process.env, UV_THREADPOOL_SIZE: "2" }, timeout: 10000 },
      );
      assert.equal(stdout.trim(), "passed");
    });
  });
}

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases2();
});

function nativeLinuxClipboardCases2(): void {
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
      // Match the prebuild's unversioned system-library imports.
      "-nostdlib",
      // Inline the fixture's allocation counters.
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
  for (const method of ["getText", "getImage"]) {
    it(`keeps JS responsive during stalled X11 connection setup: ${method}`, async (t) => {
      const sockets = new Set<Socket>();
      let connections = 0;
      const server = createServer((socket) => {
        connections++;
        sockets.add(socket);
        // Accept setup bytes without replying.
        socket.on("data", () => {});
        // libxcb owns setup blocking; release it after checking the JS timer.
        const timer = setTimeout(() => socket.destroy(), 300);
        t.after(() => clearTimeout(timer));
        socket.on("close", () => sockets.delete(socket));
      });
      t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string" && address.port > 6000);
      const env = { ...process.env, DISPLAY: `127.0.0.1:${address.port - 6000}` };
      const started = performance.now();
      const result = await readClipboard(method, env);
      assert.ok(
        performance.now() - started < 3500,
        "The worker must return after the connection closes",
      );
      assert.deepEqual(result, { ok: true, unavailable: true });
      assert.ok(connections > 0, "The helper must reach the stalled X11 server");
      assert.equal(sockets.size, 0, "The failed connection must be closed");
    });
  }
}

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  nativeLinuxClipboardCases3();
});

function nativeLinuxClipboardCases3(): void {
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
      // Match the prebuild's unversioned system-library imports.
      "-nostdlib",
      // Inline the fixture's allocation counters.
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
  it("decodes X11 STRING as Latin-1", async (t) => {
    const { env } = await startX11(t);
    execFileSync("xclip", ["-selection", "clipboard", "-in", "-t", "STRING"], {
      env,
      input: Buffer.from("café £ÿ", "latin1"),
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 5000,
    });
    const result = await readClipboard("getText", env);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.value, "café £ÿ");
  });
}
