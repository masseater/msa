import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";

import lintConfig from "../../lint.config.ts";
import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { lintProbeRoot } = lintConfig;

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

const Project = Schema.fromJsonString(
  Schema.Struct({ extends: Schema.String, include: Schema.Array(Schema.String) }),
);

const repoRoot = `${import.meta.dirname}/../..`;

const probePath = (dir: string, kind: string): string => `${dir}/lint-${kind}-probe.ts`;

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

const withProbes = <A, E, R>(
  probes: Readonly<Record<string, string>>,
  use: (run: string, lint: ReturnType<typeof lintFiles>) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = path.join(repoRoot, lintProbeRoot);
      yield* fs.makeDirectory(parent, { recursive: true });
      const run = yield* fs.makeTempDirectoryScoped({ directory: parent, prefix: "run-" });
      const project = path.join(repoRoot, "tsconfig.json");
      const { include } = yield* Schema.decodeEffect(Project)(yield* fs.readFileString(project));
      const toRoot = path.relative(run, repoRoot);
      yield* fs.writeFileString(
        path.join(run, "tsconfig.json"),
        yield* Schema.encodeEffect(Project)({
          extends: path.relative(run, project),
          include: [...include.map((pattern) => `${toRoot}/${pattern}`), "**/*"],
        }),
      );
      for (const [file, source] of Object.entries(probes)) {
        const target = path.join(run, file);
        yield* fs.makeDirectory(path.dirname(target), { recursive: true });
        yield* fs.writeFileString(target, source);
      }
      const prefix = `${path.relative(repoRoot, run)}/`;
      const lint = lintFiles(Object.keys(probes).map((file) => `${prefix}${file}`)).pipe(
        Effect.map((diagnostics) =>
          diagnostics.map((diagnostic) => ({
            ...diagnostic,
            filename: diagnostic.filename.startsWith(prefix)
              ? diagnostic.filename.slice(prefix.length)
              : diagnostic.filename,
          })),
        ),
      );
      return yield* use(run, lint);
    }),
  );

const lintProbes = (probes: Readonly<Record<string, string>>): Promise<Diagnostics> =>
  probeRuntime.runPromise(withProbes(probes, (_run, lint) => lint));

const lintAndInspectProbes = <A>(
  probes: Readonly<Record<string, string>>,
  inspect: (run: string) => A,
): Promise<{ readonly diagnostics: Diagnostics; readonly inspected: A }> =>
  probeRuntime.runPromise(
    withProbes(probes, (run, lint) =>
      Effect.all({
        diagnostics: lint,
        inspected: Effect.sync(() => inspect(run)),
      }),
    ),
  );

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

const lintProbe = {
  codesOnLine,
  lintAndInspectProbes,
  lintProbes,
  msaCodesOnLine,
  probePath,
  repoRoot,
};

export default lintProbe;
