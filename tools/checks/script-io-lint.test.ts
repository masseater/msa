import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { codesOnLine, lintProbes } = lintProbe;

const RESTRICTED = "eslint(no-restricted-";
const TYPE_ERROR = "typescript(TS";

const TEST_PROCESS = "tools/checks/test-process.ts";

const SCRIPT_OUTPUT = "../../../libs/ai/src/utils/script-output.ts";

const commandProbe = (options: string) =>
  [
    'import { Effect } from "effect";',
    `import scriptOutput from "${SCRIPT_OUTPUT}";`,
    "export const save = (page: string) =>",
    "  Effect.scoped(",
    "    Effect.gen(function* () {",
    "      const { processes } = yield* scriptOutput.ScriptOutput;",
    `      const child = yield* processes.spawn(${options});`,
    "      yield* child.write(page);",
    "    }),",
    "  );",
  ].join("\n");

const typeBypasses: Readonly<Record<string, string>> = {
  "scripts/shell-spawn.ts": commandProbe(
    '{ args: ["-c", "cat > probe-report.html"], command: "node", shell: true, stdin: "pipe" }',
  ),
  "scripts/tee-spawn.ts": commandProbe(
    '{ args: ["probe-report.html"], command: "tee", stdin: "pipe" }',
  ),
};

const bypasses: Readonly<Record<string, string>> = {
  "apps/coding-agent/scripts/tee.ts": [
    'import { spawn } from "child_process";',
    'export const tee = (out: string) => spawn("tee", [out], { stdio: ["pipe", "ignore", "inherit"] });',
  ].join("\n"),
  "libs/ai/scripts/bun-write.ts": [
    "export const save = (out: string, page: string) => {",
    "  const { write } = Bun;",
    "  return write(out, page);",
    "};",
  ].join("\n"),
  "scripts/child-process.ts": [
    'import { ChildProcess } from "effect/process";',
    'export const tee = ChildProcess.make("tee", ["report.html"]);',
  ].join("\n"),
  "scripts/console-global.ts":
    "export const print = (page: string) => console.log(`<!doctype html>${page}`);",
  "scripts/console-log.ts": [
    'import { Console } from "effect";',
    "export const print = (page: string) => Console.log(`<!doctype html>${page}`);",
  ].join("\n"),
  "scripts/effect-console.ts": [
    'import * as Console from "effect/Console";',
    "export const print = (page: string) => Console.log(page);",
  ].join("\n"),
  "scripts/effect-open.ts": [
    'import { Effect, FileSystem } from "effect";',
    "export const save = (out: string, bytes: Uint8Array) =>",
    "  Effect.gen(function* () {",
    "    const fs = yield* FileSystem.FileSystem;",
    '    const file = yield* fs.open(out, { flag: "w" });',
    "    yield* file.write(bytes);",
    "  });",
  ].join("\n"),
  "scripts/fs-promises.ts": [
    'import { open } from "node:fs/promises";',
    'export const save = (out: string) => open(out, "w");',
  ].join("\n"),
  "scripts/stdout.ts": "export const print = (page: string) => process.stdout.write(page);",
  "scripts/write-stream.ts": [
    'import { createWriteStream as toFile } from "node:fs";',
    "export const save = (out: string, page: string) => toFile(out).end(page);",
  ].join("\n"),
  "tools/checks/bun-report.ts": [
    "export const save = (out: string, page: string) => Bun.write(`${out}.html`, page);",
  ].join("\n"),
  "tools/checks/fs-report.ts": [
    'import { writeFileSync } from "node:fs";',
    "export const save = (out: string, page: string) => writeFileSync(`${out}.html`, page);",
  ].join("\n"),
  "tools/checks/test-process.ts": [
    'import { ChildProcess } from "effect/process";',
    'import { writeFileSync } from "node:fs";',
    'export const lint = ChildProcess.make("vp", ["lint"]);',
    "export const save = (out: string, page: string) => writeFileSync(`${out}.html`, page);",
  ].join("\n"),
  "tools/new-dir/report.ts": [
    'import { writeFile } from "node:fs/promises";',
    "export const save = (out: string, page: string) => writeFile(out, page);",
  ].join("\n"),
  "tools/open-sync-stdio.ts": [
    'import { spawn } from "node:child_process";',
    'import { openSync } from "node:fs";',
    "export const render = (out: string) =>",
    '  spawn("render", [], { stdio: ["ignore", openSync(out, "w"), "inherit"] });',
  ].join("\n"),
  "tools/platform-node.ts": [
    'import { NodeServices } from "@effect/platform-node";',
    "export const services = NodeServices.layer;",
  ].join("\n"),
  "tools/stdio.ts": ['import { Stdio } from "effect";', "export const stdio = Stdio.Stdio;"].join(
    "\n",
  ),
};

const allowed: Readonly<Record<string, string>> = {
  "scripts/home.ts": [
    'import { homedir } from "node:os";',
    "export const home = homedir();",
    "export const tty = process.stdin.isTTY;",
  ].join("\n"),
  "scripts/print.ts": [
    `import scriptOutput from "${SCRIPT_OUTPUT}";`,
    "export const print = (text: string) => scriptOutput.print(text);",
  ].join("\n"),
  "scripts/spawn-node.ts": commandProbe(
    '{ args: ["dist/cli.js", "--mode", "rpc"], command: "node", stdin: "pipe" }',
  ),
  "tools/checks/fixture.test.ts": [
    'import { writeFile } from "node:fs/promises";',
    'export const fixture = (dir: string) => writeFile(`${dir}/page.html`, "<p>x</p>");',
  ].join("\n"),
};

const filesWith = (
  report: Awaited<ReturnType<typeof lintProbes>>,
  prefix: string,
): readonly string[] =>
  [
    ...new Set(
      report
        .filter((diagnostic) => diagnostic.code.startsWith(prefix))
        .map((diagnostic) => diagnostic.filename),
    ),
  ].toSorted();

it("refuses file, child process, and stdout access in scripts and tools outside script-output", () =>
  lintProbes({ ...bypasses, ...typeBypasses, ...allowed }).then((report) => {
    expect(filesWith(report, RESTRICTED)).toEqual(Object.keys(bypasses).toSorted());
    expect([1, 2].map((line) => codesOnLine(report, TEST_PROCESS, line, RESTRICTED))).toEqual([
      [],
      [`${RESTRICTED}imports)`],
    ]);
    expect(filesWith(report, TYPE_ERROR).filter((file) => !(file in bypasses))).toEqual(
      Object.keys(typeBypasses).toSorted(),
    );
    return undefined;
  }));
