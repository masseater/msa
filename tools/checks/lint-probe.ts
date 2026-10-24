import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Schema } from "effect";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

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

type Diagnostics = (typeof LintReport.Type)["diagnostics"];

const repoRoot = `${import.meta.dirname}/../..`;

const probePath = (dir: string, kind: string): string =>
  `${dir}/lint-${kind}-probe-${process.pid}.ts`;

const lintFiles = (files: readonly string[]) =>
  Effect.gen(function* () {
    const { stdout } = yield* captureProcess({
      args: ["lint", "--format=json", ...files],
      command: "vp",
      cwd: repoRoot,
    });
    return (yield* Schema.decodeEffect(LintReport)(stdout)).diagnostics;
  });

const probeRuntime = ManagedRuntime.make(
  processRunnerLayer.pipe(Layer.provideMerge(NodeServices.layer)),
);

const lintProbes = (probes: Readonly<Record<string, string>>): Promise<Diagnostics> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      for (const [file, source] of Object.entries(probes))
        yield* fs.writeFileString(`${repoRoot}/${file}`, source);
    }),
    () => lintFiles(Object.keys(probes)),
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        for (const file of Object.keys(probes))
          yield* fs.remove(`${repoRoot}/${file}`, { force: true });
      }).pipe(Effect.orDie),
  ).pipe((effect) => probeRuntime.runPromise(effect));

const codesOnLine = (
  report: Diagnostics,
  file: string,
  line: number,
  prefix: string,
): readonly string[] => [
  ...new Set(
    report
      .filter(
        (diagnostic) =>
          diagnostic.filename === file &&
          diagnostic.labels[0]?.span.line === line &&
          diagnostic.code.startsWith(prefix),
      )
      .map((diagnostic) => diagnostic.code),
  ),
];

const msaCodesOnLine = (report: Diagnostics, file: string, line: number): readonly string[] =>
  codesOnLine(report, file, line, "msa(");

const lintProbe = { codesOnLine, lintProbes, msaCodesOnLine, probePath, repoRoot };

export default lintProbe;
