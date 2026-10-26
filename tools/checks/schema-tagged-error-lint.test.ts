import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";

const { lintProbes, probePath } = lintProbe;

const LOCAL_EXTENDS = "msa(no-local-class-extends)";
const DIR = "apps/coding-agent/src";

type Report = Awaited<ReturnType<typeof lintProbes>>;

const reported = (report: Report, path: string): boolean =>
  report.some((diagnostic) => diagnostic.filename === path && diagnostic.code === LOCAL_EXTENDS);

const fixtureSources: Readonly<Record<string, string>> = import.meta.glob(
  ["./fixtures/schema-tagged-error/*.ts.txt"],
  { eager: true, import: "default", query: "?raw" },
);

const fixtures = Object.entries(fixtureSources).map(([name, source]) => {
  const relative = name
    .replace(/^.*\//u, "")
    .replace(/\.ts\.txt$/u, "")
    .split("__");
  const file = relative.pop()!;
  return { dir: [DIR, ...relative].join("/"), file, source };
});

const HEADER = [
  'import tui from "@msa/tui";',
  'import { Schema } from "effect";',
  'import * as SchemaNs from "effect/Schema";',
  'import { optionalKey } from "effect/Schema";',
  "class LocalBase {}",
  "const LocalSchema = Schema.String;",
].join("\n");

const tagged = (name: string, fields: string): string =>
  `export class ${name} extends Schema.TaggedError<${name}>()("${name}", ${fields}) {}`;

const ordinary: Readonly<Record<string, string>> = {
  arrayField: tagged("O1", "{ items: Schema.Array(Schema.String) }"),
  checkPipe: tagged("O2", "{ name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))) }"),
  decodeBeside: [
    "export const decode = Schema.decodeUnknownEffect(Schema.String);",
    tagged("O3", "{ message: Schema.String }"),
  ].join("\n"),
  decodeSyncBeside: [
    'Schema.decodeUnknownSync(Schema.String)("x");',
    tagged("O4", "{ message: Schema.String }"),
  ].join("\n"),
  isBeside: [
    "export const isMessage = Schema.is(Schema.String);",
    tagged("O5", "{ message: Schema.String }"),
  ].join("\n"),
  literalsAndStruct: tagged(
    "O6",
    '{ mode: Schema.optionalKey(Schema.Literals(["a", "b"])), shape: Schema.Struct({ id: Schema.UndefinedOr(Schema.String) }) }',
  ),
  namedImport: tagged("O7", "{ mode: optionalKey(Schema.String) }"),
  namespaceImport:
    'export class O8 extends SchemaNs.TaggedError<O8>()("O8", { mode: SchemaNs.optionalKey(SchemaNs.String) }) {}',
  nullOrField: tagged("O9", "{ cause: Schema.NullOr(Schema.String) }"),
  optionalField: tagged("O10", "{ retry: Schema.optional(Schema.Boolean) }"),
  recordField: tagged("O11", "{ headers: Schema.Record(Schema.String, Schema.String) }"),
  sharedSchema: tagged("O12", "{ x: LocalSchema }"),
};

const runtimeGuarded: Readonly<Record<string, string>> = {
  callOnTheFactoryItself: `Schema.TaggedError.bind(LocalBase);\n${tagged("R2", "{ message: Schema.String }")}`,
  localArgumentToDefaultExport:
    'tui.register("Container", LocalBase);\nexport class R3 extends tui.Container {}',
  localClassInFields: tagged("R4", "{ x: LocalBase as never }"),
  localClassInsideFieldCall: tagged("R5", "{ x: Schema.optionalKey(LocalBase as never) }"),
  localTag: "export class R6 extends Schema.TaggedError<R6>()(LocalBase as never, {}) {}",
  spreadInFields: tagged("R8", "{ ...{ x: LocalBase as never } }"),
};

const reportedForms: Readonly<Record<string, string>> = {
  localBase: "export class R10 extends LocalBase {}",
  localFactoryResult:
    'const Made = Schema.TaggedError<R11>()("R11", {});\nexport class R11 extends Made {}',
  rewrittenFactory:
    '(Schema as { TaggedError: unknown }).TaggedError = LocalBase;\nexport class R12 extends Schema.TaggedError<R12>()("R12", {}) {}',
};

const formProbes = (forms: Readonly<Record<string, string>>, kind: string) =>
  Object.entries(forms).map(([name, body]) => ({
    name,
    path: probePath(DIR, `ste-${kind}-${name}`),
    source: `${HEADER}\n${body}\n`,
  }));

const fixtureProbes = fixtures.map(({ dir, file, source }) => ({
  name: file,
  path: probePath(dir, `ste-fixture-${file}`),
  source,
}));

const ordinaryProbes = formProbes(ordinary, "ordinary");
const guardedProbes = formProbes(runtimeGuarded, "guarded");
const reportedProbes = formProbes(reportedForms, "report");

it("passes the 14 Schema.TaggedError classes and ordinary Effect code, leaves local values in factory arguments to the runtime check, and reports local bases", () =>
  lintProbes(
    Object.fromEntries(
      [...fixtureProbes, ...ordinaryProbes, ...guardedProbes, ...reportedProbes].map(
        ({ path, source }) => [path, source],
      ),
    ),
  ).then((report) => {
    const outcome = (probes: readonly { readonly name: string; readonly path: string }[]) =>
      Object.fromEntries(probes.map(({ name, path }) => [name, reported(report, path)]));
    expect({
      fixtures: outcome(fixtureProbes),
      guarded: outcome(guardedProbes),
      ordinary: outcome(ordinaryProbes),
      reported: outcome(reportedProbes),
    }).toEqual({
      fixtures: Object.fromEntries(fixtureProbes.map(({ name }) => [name, false])),
      guarded: Object.fromEntries(guardedProbes.map(({ name }) => [name, false])),
      ordinary: Object.fromEntries(ordinaryProbes.map(({ name }) => [name, false])),
      reported: Object.fromEntries(reportedProbes.map(({ name }) => [name, true])),
    });
    expect(fixtureProbes).toHaveLength(14);
    return undefined;
  }));
