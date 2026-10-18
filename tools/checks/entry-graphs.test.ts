import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";

interface EntryBudget {
  readonly forbid?: ReadonlyArray<string>;
  readonly maxFiles: number;
}

const WORKSPACE: Readonly<Record<string, string>> = {
  "@msa/chord": "libs/chord/src",
  "@msa/ai": "libs/ai/src",
  "@msa/durable": "libs/durable/src",
  "@msa/agent-core": "libs/agent/src",
  "@msa/codemode": "libs/codemode/src",
  "@msa/telemetry": "libs/telemetry/src",
  "@msa/mcp": "libs/mcp/src",
  "@msa/tui": "libs/tui/src",
};

const codemodeIsolatedEntryForbids: ReadonlyArray<string> = [
  "codemode/src/index.ts",
  "runtime/host.ts",
  "runtime/worker.ts",
  "runtime/worker-main.ts",
  "codemode/src/wasm.ts",
];

const BUDGETS: Readonly<Record<string, Readonly<Record<string, EntryBudget>>>> = {
  "libs/ai": {
    "./models": {
      maxFiles: 15,
      forbid: [
        "providers/",
        "models.generated.ts",
        "index.ts",
        "utils/validation.ts",
        "utils/typebox-helpers.ts",
      ],
    },
    "./utils/*": { maxFiles: 3, forbid: ["providers/", "api/", "index.ts"] },
  },
  "libs/codemode": {
    ".": { maxFiles: 12, forbid: ["codemode/src/cloudflare.ts"] },
    "./portable": { maxFiles: 8, forbid: codemodeIsolatedEntryForbids },
    "./cloudflare": { maxFiles: 9, forbid: codemodeIsolatedEntryForbids },
  },
  "libs/durable": {
    ".": {
      maxFiles: 66,
      forbid: [
        "libs/ai/src/index.ts",
        "libs/ai/src/utils/typebox-helpers.ts",
        "libs/durable/src/images/",
      ],
    },
    "./tools": { maxFiles: 17, forbid: ["libs/durable/src/images/"] },
  },
};

const SPEC = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^;]*?\sfrom\s*)?["']([^"']+)["']/gu;

const ExportTarget = Schema.Union([Schema.String, Schema.Struct({ import: Schema.String })]);
const Manifest = Schema.fromJsonString(
  Schema.Struct({ exports: Schema.optional(Schema.Record(Schema.String, ExportTarget)) }),
);
const decodeManifest = Schema.decodeUnknownEffect(Manifest);

type Fs = FileSystem.FileSystem;
type Paths = Path.Path;

const exists = (fs: Fs, file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));

const isFile = (fs: Fs, file: string) =>
  fs.stat(file).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false),
  );

const firstExistingFile = (fs: Fs, candidates: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      if (yield* isFile(fs, candidate)) return candidate;
    }
    return undefined;
  });

const resolveRelative = (fs: Fs, path: Paths, spec: string, fromFile: string) => {
  const base = path.resolve(path.dirname(fromFile), spec);
  return firstExistingFile(fs, [base, `${base}.ts`, `${base}/index.ts`]);
};

const resolveWorkspace = (fs: Fs, path: Paths, root: string, spec: string) =>
  Effect.gen(function* () {
    const workspace = Object.entries(WORKSPACE).find(
      ([name]) => spec === name || spec.startsWith(`${name}/`),
    );
    if (workspace === undefined) return undefined;
    const [name, src] = workspace;
    if (spec === name) return path.resolve(root, src, "index.ts");
    const tail = spec.slice(name.length + 1);
    return yield* firstExistingFile(
      fs,
      [`${tail}.ts`, `${tail}/index.ts`, tail].map((candidate) =>
        path.resolve(root, src, candidate),
      ),
    );
  });

const resolveSpec = (fs: Fs, path: Paths, root: string, spec: string, fromFile: string) => {
  if (spec.startsWith("node:")) return firstExistingFile(fs, []);
  return spec.startsWith(".")
    ? resolveRelative(fs, path, spec, fromFile)
    : resolveWorkspace(fs, path, root, spec);
};

const walk = (fs: Fs, path: Paths, root: string, entryFile: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    const queue = [entryFile];
    let file = queue.pop();
    while (file !== undefined) {
      if (!seen.has(file) && !file.endsWith(".json")) {
        seen.add(file);
        const source = yield* fs.readFileString(file);
        const importer = file;
        const targets = yield* Effect.forEach(source.matchAll(SPEC), (match) =>
          resolveSpec(fs, path, root, match[2] ?? "", importer),
        );
        queue.push(...targets.filter((target) => target !== undefined));
      }
      file = queue.pop();
    }
    return seen;
  });

const sourceFor = (fs: Fs, path: Paths, root: string, pkgDir: string, distPath: string) => {
  const rel = distPath.replace(/^\.\/dist\//u, "").replace(/\.js$/u, ".ts");
  const file = path.resolve(root, pkgDir, "src", rel);
  return exists(fs, file).pipe(Effect.map((present) => (present ? file : undefined)));
};

const expand = (fs: Fs, path: Paths, root: string, pkgDir: string, entry: string, target: string) =>
  Effect.gen(function* () {
    if (!entry.includes("*")) return [[entry, target] as const];
    const relative = target.replace(/^\.\/dist\//u, "");
    const dir = path.resolve(root, pkgDir, "src", path.dirname(relative));
    if (!(yield* exists(fs, dir))) return [];
    const names = yield* fs.readDirectory(dir);
    return names
      .filter((name) => name.endsWith(".ts"))
      .map((name) => {
        const stem = name.replace(/\.ts$/u, "");
        return [entry.replace("*", stem), target.replace("*", stem)] as const;
      });
  });

const fileList = (files: ReadonlyArray<string>): string =>
  files.map((file) => `    ${file}`).join("\n");

const sizeViolations = (
  label: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> =>
  graph.length > budget.maxFiles
    ? [`${label} reaches ${graph.length} files, budget ${budget.maxFiles}\n${fileList(graph)}`]
    : [];

const forbiddenViolations = (
  label: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> =>
  (budget.forbid ?? []).flatMap((pattern) => {
    const hit = graph.filter((file) => file.includes(pattern));
    return hit.length > 0 ? [`${label} must not reach ${pattern}:\n${fileList(hit)}`] : [];
  });

const budgetViolations = (
  pkgDir: string,
  name: string,
  graph: ReadonlyArray<string>,
  budget: EntryBudget,
): ReadonlyArray<string> => {
  const label = `${pkgDir} export "${name}"`;
  return [...sizeViolations(label, graph, budget), ...forbiddenViolations(label, graph, budget)];
};

const graphViolations = (
  fs: Fs,
  path: Paths,
  root: string,
  pkgDir: string,
  name: string,
  source: string,
  budget: EntryBudget,
) =>
  walk(fs, path, root, source).pipe(
    Effect.map((files) => [...files].map((file) => path.relative(root, file))),
    Effect.map((graph) => budgetViolations(pkgDir, name, graph, budget)),
  );

const checkExpanded = (
  fs: Fs,
  path: Paths,
  root: string,
  pkgDir: string,
  [name, distPath]: readonly [string, string],
  budget: EntryBudget,
) =>
  Effect.gen(function* () {
    const source = yield* sourceFor(fs, path, root, pkgDir, distPath);
    if (source === undefined) {
      return [`${pkgDir} export "${name}" points at ${distPath}, which has no source file`];
    }
    return yield* graphViolations(fs, path, root, pkgDir, name, source, budget);
  });

const checkEntry = (
  fs: Fs,
  path: Paths,
  root: string,
  pkgDir: string,
  [entry, budget]: readonly [string, EntryBudget],
  exportsMap: Readonly<Record<string, typeof ExportTarget.Type>> | undefined,
) =>
  Effect.gen(function* () {
    const declared = exportsMap?.[entry];
    if (declared === undefined) {
      return [`${pkgDir} declares no export "${entry}" but a budget exists for it`];
    }
    const target = typeof declared === "string" ? declared : declared.import;
    const expanded = yield* expand(fs, path, root, pkgDir, entry, target);
    const results = yield* Effect.forEach(expanded, (item) =>
      checkExpanded(fs, path, root, pkgDir, item, budget),
    );
    return results.flat();
  });

const checkPackage = (
  fs: Fs,
  path: Paths,
  root: string,
  [pkgDir, budgets]: readonly [string, Readonly<Record<string, EntryBudget>>],
) =>
  Effect.gen(function* () {
    const manifest = yield* decodeManifest(
      yield* fs.readFileString(path.resolve(root, pkgDir, "package.json")),
    );
    const results = yield* Effect.forEach(Object.entries(budgets), (budgetEntry) =>
      checkEntry(fs, path, root, pkgDir, budgetEntry, manifest.exports),
    );
    return results.flat();
  });

const collectViolations = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const results = yield* Effect.forEach(Object.entries(BUDGETS), (entry) =>
    checkPackage(fs, path, root, entry),
  );
  return results.flat();
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const checkBudgets = collectViolations.pipe(
  Effect.tap((violations) => Effect.sync(() => expect(violations).toEqual([]))),
);

it("keeps every package export within its entry-graph budget", () =>
  runtime.runPromise(checkBudgets));
