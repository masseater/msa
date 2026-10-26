import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";

import classExtendsCases from "../../../tools/checks/class-extends-cases.ts";
import classSealTransform from "../../../tools/class-seal/transform.ts";
import classSealProcess from "./class-seal-process.ts";
import classSealSources from "./class-seal-sources.ts";

const { cases } = classExtendsCases;
const { runNode } = classSealProcess;
const { packageRoot } = classSealSources;

const LOCAL_BASE = "同じパッケージで定義したクラスを継承しない";

const runtimeFile = `${packageRoot}/src/core/platform/node/class-seal.ts`;

const sharedFile = `${packageRoot}/src/core/platform/node/class-seal-tui.ts`;

const fixtureDirs = ["class-seal", "class-seal-external"] as const;

const helpers: ReadonlySet<string> = new Set([
  "extend.ts",
  "holder.ts",
  "local.ts",
  "shared-bases.ts",
  "writer.ts",
]);

type Guard = "plain" | "sealed" | "without-lock" | "without-record" | "without-both";

const LOCK = [
  "for (const link of links) if (link !== Object.prototype) Object.preventExtensions(link);",
  "void links;",
] as const;

const RECORD = [
  "parents.has(link) && parentOf(link) === parents.get(link)",
  'typeof link === "object" || typeof link === "function"',
] as const;

const mutations: Readonly<Record<Guard, readonly (readonly [string, string])[]>> = {
  plain: [],
  sealed: [],
  "without-both": [LOCK, RECORD],
  "without-lock": [LOCK],
  "without-record": [RECORD],
};

const mutated = (code: string, guard: Guard): string =>
  mutations[guard].reduce((current, [from, to]) => {
    if (current.split(from).length !== 2)
      throw new Error(`${guard}: the guard no longer has exactly one ${JSON.stringify(from)}`);
    return current.replace(from, to);
  }, code);

const kinds: Readonly<Record<string, readonly [string, string]>> = {
  asyncFunction: ["async function Base() {}", "[Base]"],
  boundClass: ["class Target {}\nconst Base = Target.bind(null);", "[Base, Target]"],
  boundFunction: ["function Target() {}\nconst Base = Target.bind(null);", "[Base, Target]"],
  class: ["class Base {}", "[Base]"],
  functionDeclaration: ["function Base() {}", "[Base]"],
  functionExpression: ["const Base = function () {};", "[Base]"],
  generator: ["function* Base() {}", "[Base]"],
  method: ["const Base = { Base() {} }.Base;", "[Base]"],
  proxyClass: ["class Target {}\nconst Base = new Proxy(Target, {});", "[Base, Target]"],
  proxyFunction: ["function Target() {}\nconst Base = new Proxy(Target, {});", "[Base, Target]"],
};

const FORM_HEADER = [
  'import tui from "@msa/tui";',
  'import { Context, Data } from "effect";',
  'import { Error as ChordBase, TaggedError as Mixin } from "effect/Data";',
  'import * as DataNs from "effect/Data";',
];

const formPrelude = (define: string, carried: string): readonly string[] => [
  define,
  "const withFoo = <T,>(base: T): T => base;",
  "function helper() { return RangeError; }",
  "const arrowHelper = () => RangeError;",
  "function localHelper() { return Base; }",
  "const arrowAlias = arrowHelper;",
  "const localArrow = () => Base;",
  "const localAlias = localArrow;",
  "function innerOnly() { const inner = () => Base; return inner === undefined ? RangeError : URIError; }",
  "const flag = true;",
  "const declared = <T,>(value: T, ..._rest: unknown[]): T => value;",
  "const hidden = Base;",
  "const arr: unknown[] = [RangeError];",
  "arr.unshift(Base);",
  "const mixed = { base: RangeError as unknown };",
  "declared(Mixin(mixed as never));",
  "mixed.base = Base;",
  `export const carried = ${carried};`,
];

const staticallyPassed = cases.flatMap(([statement, expected, setup = []]) => {
  const name = /^export class (\w+) /u.exec(statement)?.[1];
  return expected === undefined && name !== undefined ? [{ name, setup, statement }] : [];
});

const formSource = (define: string, carried: string, form: (typeof staticallyPassed)[number]) =>
  [
    ...FORM_HEADER,
    ...formPrelude(define, carried),
    ...form.setup.map((line) => `try { ${line} } catch {}`),
    form.statement,
    `export default ${form.name};`,
    "",
  ].join("\n");

const localSource = (define: string, carried: string): string =>
  `${define}\nexport const carried = ${carried};\nexport default Base;\n`;

type Written = { readonly file: string; readonly name: string };

const seal = (code: string, file: string, runtime: string, shared: string): string =>
  classSealTransform.sealClasses(code, { filename: file, module: file, runtime, shared }).code;

type Selection = { readonly forms: boolean; readonly fixture: (name: string) => boolean };

const everything: Selection = { fixture: () => true, forms: true };

const writeVariants = (root: string, guard: Guard, selection: Selection) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const written: Written[] = [];
    const runtime = path.join(root, `guard-${guard}.ts`);
    yield* fs.writeFileString(runtime, mutated(yield* fs.readFileString(runtimeFile), guard));
    const shared = path.join(root, `guard-${guard}-tui.ts`);
    const sharedCode = (yield* fs.readFileString(sharedFile)).replace(
      '"./class-seal.ts"',
      `"./guard-${guard}.ts"`,
    );
    yield* fs.writeFileString(shared, sharedCode);
    const put = (file: string, code: string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(
          file,
          guard === "plain" ? code : seal(code, file, runtime, shared),
        );
      });
    for (const [kind, [define, carried]] of Object.entries(kinds)) {
      const base = path.join(root, guard, kind);
      for (const dir of fixtureDirs) {
        const from = path.join(packageRoot, "test", "fixtures", dir);
        for (const name of yield* fs.readDirectory(from)) {
          const file = path.join(base, dir, name);
          const code =
            name === "local.ts"
              ? localSource(define, carried)
              : yield* fs.readFileString(path.join(from, name));
          yield* put(file, code);
          if (dir === "class-seal" && !helpers.has(name) && selection.fixture(name))
            written.push({ file, name: `fixture/${name.replace(/\.ts$/u, "")}/${kind}` });
        }
      }
      for (const form of selection.forms ? staticallyPassed : []) {
        const file = path.join(base, "forms", `${form.name}.ts`);
        yield* put(file, formSource(define, carried, form));
        written.push({ file, name: `form/${form.name}/${kind}` });
      }
    }
    return written;
  });

const outcomeScript = (written: readonly Written[]): string =>
  [
    `const LOCAL_BASE = ${JSON.stringify(LOCAL_BASE)};`,
    `const modules = ${JSON.stringify(written)};`,
    "const chain = (value) => { const links = []; for (let v = value; v !== null && v !== undefined; v = Object.getPrototypeOf(v)) links.push(v); return links; };",
    "const classify = (message) => message.includes(LOCAL_BASE) ? 'refused' : /not extensible/u.test(message) ? 'not-extensible' : /read[- ]only|Cannot assign|Cannot add property|Cannot redefine|Cannot define property/u.test(message) ? 'read-only' : /not a constructor|valid prototype|is not a function/u.test(message) ? 'not-constructor' : /prototype may only be an Object or null/u.test(message) ? 'no-prototype' : `other: ${message}`;",
    "const [{ Context, Data, Schema }, { default: tui }] = await Promise.all([import('effect'), import('@msa/tui')]);",
    "const parentOf = (value) => Object.getPrototypeOf(value);",
    "const roots = [parentOf(Data.TaggedError('probe')), parentOf(Schema.TaggedError()('probe', {})), parentOf(Context.Service()('probe')), tui.Box, tui.Container, tui.Editor, tui.KeybindingsManager, tui.Loader, tui.Text];",
    "const parents = new Map();",
    "for (const root of roots) for (const start of [root, root.prototype]) for (let link = start; link !== null && link !== undefined && !parents.has(link); link = parentOf(link)) parents.set(link, parentOf(link));",
    "const restore = () => { for (const [link, parent] of parents) if (parentOf(link) !== parent) Reflect.setPrototypeOf(link, parent); };",
    "const outcomes = {};",
    "for (const { file, name } of modules) {",
    "  try {",
    "    const loaded = await import(file);",
    "    const exported = loaded.default;",
    "    const pair = typeof exported === 'object' && exported !== null && 'subject' in exported;",
    "    const subject = pair ? exported.subject : exported;",
    "    const local = pair ? [exported.local] : await import(file.replace(/[^/]+$/u, 'local.ts')).then((m) => m.carried, () => loaded.carried);",
    "    const marks = (local ?? loaded.carried).flatMap((value) => [value, value?.prototype]).filter((value) => value !== undefined && value !== null);",
    "    const links = [...chain(subject), ...chain(subject?.prototype)];",
    "    outcomes[name] = links.some((link) => marks.includes(link)) ? 'reached' : pair && exported.written === false ? 'write-refused' : 'loads';",
    "  } catch (error) {",
    "    outcomes[name] = classify(error instanceof Error ? error.message : String(error));",
    "  } finally {",
    "    restore();",
    "  }",
    "}",
    "process.stdout.write(JSON.stringify(outcomes));",
  ].join("\n");

const Outcomes = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const runtime = ManagedRuntime.make(NodeServices.layer);

const outcomesOf = (
  guard: Guard,
  selection: Selection = everything,
): Promise<Readonly<Record<string, string>>> =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = `${packageRoot}/.class-seal-probe`;
        yield* fs.makeDirectory(parent, { recursive: true });
        const root = yield* fs.makeTempDirectoryScoped({ directory: parent, prefix: "run-" });
        const written = yield* writeVariants(root, guard, selection);
        const path = yield* Path.Path;
        const resolver = path.join(import.meta.dirname, "../src/experimental/source-resolver.ts");
        const { stderr, stdout } = yield* Effect.promise(() =>
          runNode(
            ["--import", resolver, "--input-type=module", "--eval", outcomeScript(written)],
            packageRoot,
          ),
        );
        if (stdout === "") return yield* Effect.die(new Error(stderr));
        return yield* Schema.decodeEffect(Outcomes)(stdout).pipe(Effect.orDie);
      }),
    ),
  );

const classSealVariants = { kinds, outcomesOf, staticallyPassed };

export default classSealVariants;
