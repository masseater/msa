import { Effect, ManagedRuntime, Schema } from "effect";

import scriptOutput from "../../libs/ai/src/utils/script-output.ts";
import lintConfig from "../../lint.config.ts";

const { lintProbeRoot } = lintConfig;

const LintReport = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        filename: Schema.String,
        help: Schema.optional(Schema.String),
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

const TSCONFIG_ERROR = "typescript(tsconfig-error)";

const lintFiles = (files: readonly string[]) =>
  Effect.gen(function* () {
    const { processes } = yield* scriptOutput.ScriptOutput;
    const { stdout } = yield* processes.run({
      args: ["lint", "--format=json", ...files],
      command: "vp",
      cwd: repoRoot,
    });
    const { diagnostics } = yield* Schema.decodeEffect(LintReport)(stdout);
    const tsconfigErrors = diagnostics.filter(({ code }) => code === TSCONFIG_ERROR);
    if (tsconfigErrors.length > 0) {
      return yield* Effect.die(
        new Error(
          `vp lint dropped its type-aware diagnostics: ${tsconfigErrors.map(({ help }) => help).join("; ")}`,
        ),
      );
    }
    return diagnostics;
  });

const probeRuntime = ManagedRuntime.make(scriptOutput.scriptOutputLayer);

const withProbes = <A, E, R>(
  probes: Readonly<Record<string, string>>,
  use: (run: string, lint: ReturnType<typeof lintFiles>) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { files: fs, path, writeTextFile } = yield* scriptOutput.ScriptOutput;
      const parent = path.join(repoRoot, lintProbeRoot);
      yield* fs.makeDirectory(parent);
      const run = yield* fs.makeTempDirectoryScoped("run-", parent);
      const project = path.join(repoRoot, "tsconfig.json");
      const { include } = yield* Schema.decodeEffect(Project)(yield* fs.readText(project));
      const toRoot = path.relative(run, repoRoot);
      yield* writeTextFile(
        path.join(run, "tsconfig.json"),
        yield* Schema.encodeEffect(Project)({
          extends: path.relative(run, project),
          include: [...include.map((pattern) => `${toRoot}/${pattern}`), "**/*"],
        }),
      );
      for (const [file, source] of Object.entries(probes)) {
        const target = path.join(run, file);
        yield* fs.makeDirectory(path.dirname(target));
        yield* writeTextFile(target, source);
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
