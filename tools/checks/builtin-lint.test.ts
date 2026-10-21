import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vite-plus/test";

import lintConfig from "../../lint.config.ts";
import captureProcessModule from "../capture-process.ts";
import lintProbe from "./lint-probe.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { lintProbes, msaCodesOnLine, probePath, repoRoot } = lintProbe;
const { builtinModuleBases, effectReplaceableBuiltins, fsSyncFunctions } = lintConfig;

const LOOKUP = "msa(no-builtin-module-lookup)";
const REQUIRE = "msa(no-builtin-require)";
const SYNC_FS = "msa(no-sync-fs)";
const NODE_BUILTIN_IMPORT = "effecttsgo(node-builtin-import)";

const cases: readonly (readonly [statement: string, expected: string | undefined])[] = [
  ['void Reflect.get(process, "getBuiltinModule");', LOOKUP],
  ['void process.getBuiltinModule?.("node:fs");', LOOKUP],
  ['void process["getBuiltinModule"];', LOOKUP],
  ["void process[`getBuiltinModule`];", LOOKUP],
  ['void process["get" + "BuiltinModule"];', LOOKUP],
  ['{ const p = process; void p["get" + "Builtin" + "Module"]; }', LOOKUP],
  ['{ const head = "get"; void process[`${head}BuiltinModule`]; }', LOOKUP],
  ["void process[dynamicKey];", LOOKUP],
  ["{ const p = process; void p[dynamicKey]; }", LOOKUP],
  ["void Reflect.get(process, dynamicKey);", LOOKUP],
  ['void globalThis["pro" + "cess"][dynamicKey];', LOOKUP],
  ["void globalThis[dynamicKey];", LOOKUP],
  ["{ const { ...rest } = process; void rest[dynamicKey]; }", LOOKUP],
  ["void Object.values(process);", LOOKUP],
  ["void (({ getBuiltinModule }: NodeJS.Process) => getBuiltinModule)(process);", LOOKUP],
  [
    "void (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;",
    LOOKUP,
  ],
  ['void process.binding("fs");', LOOKUP],
  ['void process._linkedBinding("fs");', LOOKUP],
  ['void process["bind" + "ing"]("fs");', LOOKUP],
  ['{ const { binding } = process; void binding("fs"); }', LOOKUP],
  ['{ const b = process.binding; void b("fs"); }', LOOKUP],
  ['void globalThis.process.binding("fs");', LOOKUP],
  ["void [process.binding];", LOOKUP],
  ['void Reflect.get(process, "binding");', LOOKUP],
  ['{ const binding = (id: string) => id; void binding("fs"); }', undefined],
  ['void Object.getOwnPropertyDescriptor(process, "platform");', undefined],
  ['void globalThis[Symbol.for("msa")];', undefined],
  ["void globalThis[`msa_${dynamicKey}`];", undefined],
  ['void load("fs");', REQUIRE],
  ['void createRequire(import.meta.url)("node:child_process");', REQUIRE],
  ['void nodeModule.createRequire(import.meta.url)("node:fs");', REQUIRE],
  ['void moduleNamespace.createRequire(import.meta.url)("crypto");', REQUIRE],
  ['void aliasedFactory(import.meta.url)("node:path");', REQUIRE],
  ['{ const loader = createRequire(import.meta.url); void loader("http"); }', REQUIRE],
  ['{ let loader; loader = createRequire(import.meta.url); void loader("https"); }', REQUIRE],
  [
    '{ const factory = nodeModule.createRequire; void factory(import.meta.url)("stream"); }',
    REQUIRE,
  ],
  [
    '{ const { createRequire: factory } = nodeModule; void factory(import.meta.url)("timers"); }',
    REQUIRE,
  ],
  ['void nodeModule["create" + "Require"](import.meta.url)("console");', REQUIRE],
  ['void Module.prototype.require("node:fs");', REQUIRE],
  ["void load(dynamicKey);", REQUIRE],
  ['void load.call(undefined, "fs");', REQUIRE],
  ["void [createRequire];", REQUIRE],
  ['void require("node:path/posix");', REQUIRE],
  ['void module.require("crypto");', REQUIRE],
  ['void import("node:fs/promises");', REQUIRE],
  ['void (module.constructor as { _load(id: string): unknown })._load("fs");', REQUIRE],
  ['void Module._load("node:fs");', REQUIRE],
  ['{ const Loader = module.constructor; void Loader._load("path"); }', REQUIRE],
  ["void module.exports;", undefined],
  ['void Module.toString().startsWith("fs");', undefined],
  ['export { default } from "node:path";', REQUIRE],
  ['export * from "node:path";', REQUIRE],
  ['export * as cp from "node:child_process";', REQUIRE],
  ['export { readFile } from "fs";', REQUIRE],
  ['export { createRequire as factoryExport } from "node:module";', REQUIRE],
  ['export * from "node:module";', REQUIRE],
  ['export { platform } from "node:os";', undefined],
  ["void import(dynamicKey);", REQUIRE],
  ["void import(pathToFileURL(dynamicKey).href);", undefined],
  ["void import(pathToFileURL(dynamicKey));", undefined],
  ["void import(`${pathToFileURL(dynamicKey).href}?v=${dynamicKey}`);", undefined],
  ['void import(pathToFileURL(dynamicKey).href + "?v=1");', undefined],
  ["void import(nodeUrl.pathToFileURL(dynamicKey).href);", undefined],
  ["void import(new URL(dynamicKey).href);", REQUIRE],
  ["void import(`${dynamicKey}${pathToFileURL(dynamicKey).href}`);", REQUIRE],
  ['void import(dynamicKey + pathToFileURL("x").href);', REQUIRE],
  ["void import(fileUrlLike(dynamicKey).href);", REQUIRE],
  ['void load("node:os");', undefined],
  ['void load.resolve("node:fs");', undefined],
  ['void existsSync("/");', SYNC_FS],
  ['void fs.readFileSync("/");', SYNC_FS],
  ['void fs["readFile" + "Sync"];', SYNC_FS],
  ["{ const { writeFileSync: write } = fs; void write; }", SYNC_FS],
  ['void fs.promises.readFile("/");', undefined],
];

const HEADER = [
  'import nodeModule, { Module, createRequire, createRequire as aliasedFactory } from "node:module";',
  'import * as moduleNamespace from "node:module";',
  'import fs, { existsSync } from "node:fs";',
  'import nodeUrl, { pathToFileURL } from "node:url";',
  "const fileUrlLike = (path: string) => new URL(path);",
  "const load = createRequire(import.meta.url);",
  "const dynamicKey = String(Date.now());",
];

const bypassProbe = [...HEADER, ...cases.map(([statement]) => statement)].join("\n");

const importedBases = builtinModuleBases.filter((base) => !base.startsWith("_"));

const importProbe = [
  ...importedBases.map((base, index) => `import * as m${index} from "node:${base}";`),
  `export default [${importedBases.map((_, index) => `m${index}`).join(", ")}];`,
].join("\n");

const BYPASS_PROBE = probePath("tools/checks", "bypass");
const IMPORT_PROBE = probePath("tools/checks", "import");

const SYNC_NAMES_SCRIPT =
  'console.log(Object.keys(require("fs")).filter((key) => key.endsWith("Sync")).join(" "))';

const runtimeSyncNames = captureProcess({
  args: ["-e", SYNC_NAMES_SCRIPT],
  command: process.execPath,
  cwd: repoRoot,
}).pipe(Effect.map(({ stdout }) => stdout.trim().split(" ")));

const checkProbes = Effect.gen(function* () {
  const report = yield* Effect.promise(() =>
    lintProbes({ [BYPASS_PROBE]: bypassProbe, [IMPORT_PROBE]: importProbe }),
  );
  for (const [index, [statement, expected]] of cases.entries()) {
    const codes = msaCodesOnLine(report, BYPASS_PROBE, HEADER.length + index + 1);
    expect({ codes, statement }).toEqual({
      codes: expected === undefined ? [] : [expected],
      statement,
    });
  }
  const flaggedBases = report
    .filter((diagnostic) => diagnostic.filename === IMPORT_PROBE)
    .filter((diagnostic) => diagnostic.code === NODE_BUILTIN_IMPORT)
    .map((diagnostic) => importedBases[(diagnostic.labels[0]?.span.line ?? 0) - 1]);
  expect([...new Set(flaggedBases)].toSorted()).toEqual([...effectReplaceableBuiltins].toSorted());
  const missingSyncNames = (yield* runtimeSyncNames).filter(
    (name) => !fsSyncFunctions.includes(name),
  );
  expect(missingSyncNames).toEqual([]);
});

const runtime = ManagedRuntime.make(Layer.merge(processRunnerLayer, NodeServices.layer));

it("flags every bypass of the platform layer and keeps the replaceable list in step with effecttsgo", () =>
  runtime.runPromise(checkProbes));
