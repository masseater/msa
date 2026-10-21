import { Effect } from "effect";

import type envTypes from "../env/index.types.ts";
import envConformanceSupport from "./env-conformance-support.ts";
import type envConformanceSupportTypes from "./env-conformance-support.types.ts";

const { abortedContext, codeOf, context, listed, value } = envConformanceSupport;

const writeAll = Effect.fnUntraced(function* (
  env: envTypes.ExecutionEnv,
  files: readonly string[],
) {
  for (const file of files) yield* value(() => env.writeFile(file, "", context));
});

const listCode = (env: envTypes.ExecutionEnv, path: string, options?: envTypes.ListFilesOptions) =>
  codeOf(() => env.listFiles!(path, options, context));

const depthFirst: envConformanceSupportTypes.EnvCaseSpec = {
  name: "listFiles lists files and directories depth first in name order",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* writeAll(env, ["b.txt", "a/z.txt", "a/b/c.txt", ".hidden/x", "A.txt"]);
      yield* value(() => env.createDir("empty", undefined, context));
      const visible = ["f A.txt", "d a", "d a/b", "f a/b/c.txt", "f a/z.txt", "f b.txt", "d empty"];
      assert.deepEqual(yield* listed(env, "."), {
        entries: ["d .hidden", "f .hidden/x", ...visible],
        truncated: false,
      });
      assert.deepEqual((yield* listed(env, ".", { hidden: false })).entries, visible);
      const expected = { entries: ["d b", "f b/c.txt", "f z.txt"], truncated: false };
      assert.deepEqual(yield* listed(env, "a"), expected);
      const absolute = yield* value(() => env.absolutePath("a", context));
      assert.deepEqual(yield* listed(env, absolute), expected);
      assert.deepEqual(yield* listed(env, "empty"), { entries: [], truncated: false });
    }),
};

const ignored: envConformanceSupportTypes.EnvCaseSpec = {
  name: "listFiles skips what git ignores in work trees, .git, and excluded names",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* writeAll(env, [
        "keep.txt",
        "out/x.js",
        "sub/keep.txt",
        "sub/drop.log",
        "node_modules/m/i.js",
      ]);
      yield* value(() => env.writeFile(".gitignore", "out/\n*.log\n", context));
      yield* value(() => env.writeFile("sub/.gitignore", "!keep.txt\n", context));
      assert.ok((yield* listed(env, ".")).entries.includes("f out/x.js"));
      yield* value(() => env.writeFile(".git/HEAD", "ref: refs/heads/main\n", context));
      yield* value(() => env.writeFile(".git/info/exclude", "keep.txt\n", context));
      assert.deepEqual((yield* listed(env, ".", { exclude: ["node_modules"] })).entries, [
        "f .gitignore",
        "d sub",
        "f sub/.gitignore",
        "f sub/keep.txt",
      ]);
      assert.deepEqual((yield* listed(env, "sub")).entries, ["f .gitignore", "f keep.txt"]);
      const all = (yield* listed(env, ".", { gitignore: false })).entries;
      assert.ok(
        all.includes("f out/x.js") &&
          all.includes("f node_modules/m/i.js") &&
          all.includes("f keep.txt"),
      );
      assert.ok(!all.some((entry) => entry.includes(".git/") || entry === "d .git"));
    }),
};

const bounds: envConformanceSupportTypes.EnvCaseSpec = {
  name: "listFiles stops at its bounds and reports truncated",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* writeAll(env, ["a", "b", "c"]);
      assert.deepEqual(yield* listed(env, ".", { maxEntries: 2 }), {
        entries: ["f a", "f b"],
        truncated: true,
      });
      assert.deepEqual(yield* listed(env, ".", { maxEntries: 3 }), {
        entries: ["f a", "f b", "f c"],
        truncated: false,
      });
      assert.deepEqual(yield* listed(env, ".", { maxBytes: 6 }), {
        entries: ["f a", "f b"],
        truncated: true,
      });
      assert.deepEqual(yield* listed(env, ".", { maxEntries: 0 }), {
        entries: [],
        truncated: true,
      });
      assert.strictEqual(yield* listCode(env, ".", { maxEntries: -1 }), "invalid");
      assert.strictEqual(yield* listCode(env, ".", { timeoutMs: 1.5 }), "invalid");
    }),
};

const failures: envConformanceSupportTypes.EnvCaseSpec = {
  name: "listFiles fails on missing directories, files, and aborts",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("file.txt", "", context));
      assert.strictEqual(yield* listCode(env, "missing"), "not_found");
      assert.strictEqual(yield* listCode(env, "file.txt"), "not_directory");
      assert.strictEqual(
        yield* codeOf(() => env.listFiles!(".", undefined, abortedContext())),
        "aborted",
      );
    }),
};

const listCases: readonly envConformanceSupportTypes.EnvCaseSpec[] = [
  depthFirst,
  ignored,
  bounds,
  failures,
];

const listedSymlinks: envConformanceSupportTypes.EnvCaseSpec = {
  name: "listFiles lists symbolic links without following them",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("dir/inner.txt", "", context));
      const linked = yield* value(() =>
        env.exec(
          [...shell, "ln -s dir link && ln -s missing dangling && ln -s .. dir/loop"],
          undefined,
          context,
        ),
      );
      assert.strictEqual(linked.exitCode, 0);
      assert.deepEqual((yield* listed(env, ".")).entries, [
        "l dangling",
        "d dir",
        "f dir/inner.txt",
        "l dir/loop",
        "l link",
      ]);
      assert.deepEqual((yield* listed(env, "link")).entries, ["f inner.txt", "l loop"]);
    }),
};

const envConformanceList = {
  listCases,
  listedSymlinks,
};

export default envConformanceList;
