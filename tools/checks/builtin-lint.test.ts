import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import lintConfig from "../../lint.config.ts";
import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { builtinModuleBases, effectReplaceableBuiltins } = lintConfig;

const LOOKUP = "msa(no-builtin-module-lookup)";
const REQUIRE = "msa(no-builtin-require)";
const NODE_BUILTIN_IMPORT = "effecttsgo(node-builtin-import)";

const LintReport = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        filename: Schema.String,
        labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Finite }) })),
      }),
    ),
  }),
);

const cases: readonly (readonly [expression: string, expected: string | undefined])[] = [
  ['Reflect.get(process, "getBuiltinModule")', LOOKUP],
  ['process.getBuiltinModule?.("node:fs")', LOOKUP],
  ['process["getBuiltinModule"]', LOOKUP],
  ["process[`getBuiltinModule`]", LOOKUP],
  ["(({ getBuiltinModule }: NodeJS.Process) => getBuiltinModule)(process)", LOOKUP],
  ["(globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process", LOOKUP],
  ['load("fs")', REQUIRE],
  ['createRequire(import.meta.url)("node:child_process")', REQUIRE],
  ['require("node:path/posix")', REQUIRE],
  ['module.require("crypto")', REQUIRE],
  ['import("node:fs/promises")', REQUIRE],
  ['load("node:os")', undefined],
];

const HEADER = [
  'import { createRequire } from "node:module";',
  "const load = createRequire(import.meta.url);",
];

const bypassProbe = [
  ...HEADER,
  ...cases.map(([expression], index) => `const c${index} = ${expression};`),
  `export default [${cases.map((_, index) => `c${index}`).join(", ")}];`,
].join("\n");

const importedBases = builtinModuleBases.filter((base) => !base.startsWith("_"));

const importProbe = [
  ...importedBases.map((base, index) => `import * as m${index} from "node:${base}";`),
  `export default [${importedBases.map((_, index) => `m${index}`).join(", ")}];`,
].join("\n");

const probeName = (kind: string) => `tools/checks/builtin-lint-${kind}-probe-${process.pid}.ts`;
const BYPASS_PROBE = probeName("bypass");
const IMPORT_PROBE = probeName("import");

const repoRoot = `${import.meta.dirname}/../..`;

const writeProbes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(`${repoRoot}/${BYPASS_PROBE}`, bypassProbe);
  yield* fs.writeFileString(`${repoRoot}/${IMPORT_PROBE}`, importProbe);
});

const removeProbes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(`${repoRoot}/${BYPASS_PROBE}`, { force: true });
  yield* fs.remove(`${repoRoot}/${IMPORT_PROBE}`, { force: true });
}).pipe(Effect.orDie);

const lintProbes = Effect.gen(function* () {
  const { stdout } = yield* captureProcess({
    args: ["lint", "--format=json", BYPASS_PROBE, IMPORT_PROBE],
    command: "vp",
    cwd: repoRoot,
  });
  return (yield* Schema.decodeEffect(LintReport)(stdout)).diagnostics;
});

const diagnostics = Effect.acquireUseRelease(
  writeProbes,
  () => lintProbes,
  () => removeProbes,
);

const codesOnLine = (
  report: (typeof LintReport.Type)["diagnostics"],
  file: string,
  line: number,
): readonly string[] =>
  report
    .filter(
      (diagnostic) =>
        diagnostic.filename === file &&
        diagnostic.labels[0]?.span.line === line &&
        diagnostic.code.startsWith("msa("),
    )
    .map((diagnostic) => diagnostic.code);

const checkProbes = Effect.gen(function* () {
  const report = yield* diagnostics;
  for (const [index, [expression, expected]] of cases.entries()) {
    const codes = codesOnLine(report, BYPASS_PROBE, HEADER.length + index + 1);
    expect({ codes: [...new Set(codes)], expression }).toEqual({
      codes: expected === undefined ? [] : [expected],
      expression,
    });
  }
  const flaggedBases = report
    .filter((diagnostic) => diagnostic.filename === IMPORT_PROBE)
    .filter((diagnostic) => diagnostic.code === NODE_BUILTIN_IMPORT)
    .map((diagnostic) => importedBases[(diagnostic.labels[0]?.span.line ?? 0) - 1]);
  expect([...new Set(flaggedBases)].toSorted()).toEqual([...effectReplaceableBuiltins].toSorted());
});

const runtime = ManagedRuntime.make(Layer.merge(processRunnerLayer, NodeServices.layer));

it("flags every bypass of the platform layer and keeps the replaceable list in step with effecttsgo", () =>
  runtime.runPromise(checkProbes));
