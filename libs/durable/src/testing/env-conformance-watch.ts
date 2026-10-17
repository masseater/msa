import { Effect } from "effect";

import type { WatchChange, WatchTarget } from "../env/index.ts";
import {
  context,
  type EnvCaseSpec,
  settled,
  value,
  watching,
  watchTimeoutMs,
} from "./env-conformance-support.ts";

const missingFile: EnvCaseSpec = {
  name: "watch reports a missing file's creation, changes, replacement and removal",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    watching(env, [{ path: "AGENTS.md" }], ({ expectChange }) =>
      Effect.gen(function* () {
        const write = (text: string) => value(() => env.writeFile("AGENTS.md", text, context));
        yield* expectChange("AGENTS.md", write("one"));
        yield* expectChange("AGENTS.md", write("two!"));
        yield* expectChange(
          "AGENTS.md",
          Effect.gen(function* () {
            yield* value(() => env.writeFile("AGENTS.md.tmp", "three", context));
            yield* value(() => env.renameFile("AGENTS.md.tmp", "AGENTS.md", context));
          }),
        );
        yield* expectChange("AGENTS.md", write("four"));
        yield* expectChange(
          "AGENTS.md",
          value(() => env.remove("AGENTS.md", undefined, context)),
        );
      }),
    ),
};

const missingAncestors: EnvCaseSpec = {
  name: "watch reports a missing target whose ancestors are created",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    watching(env, [{ path: "a/b/c/AGENTS.md" }], ({ expectChange }) =>
      expectChange(
        "a/b/c/AGENTS.md",
        value(() => env.writeFile("a/b/c/AGENTS.md", "x", context)),
      ),
    ),
};

const createdDirectories: EnvCaseSpec = {
  name: "watch follows directories created together with their contents",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("skills", undefined, context));
      yield* watching(env, [{ path: "skills", recursive: true }], ({ expectChange }) =>
        Effect.gen(function* () {
          const write = (path: string, text: string) =>
            expectChange(
              path,
              value(() => env.writeFile(path, text, context)),
            );
          yield* write("skills/a/b/SKILL.md", "one");
          yield* write("skills/a/b/SKILL.md", "two!");
          yield* write("skills/a/b/c/SKILL.md", "deeper");
        }),
      );
    }),
};

const renamedParent: EnvCaseSpec = {
  name: "watch keeps watching a path whose parent is renamed and recreated",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("proj/.msa/skills/x.md", "x", context));
      yield* watching(env, [{ path: "proj/.msa/skills", recursive: true }], ({ expectChange }) =>
        Effect.gen(function* () {
          yield* expectChange(
            "proj/.msa/skills",
            value(() => env.renameFile("proj/.msa", "proj/old", context)),
          );
          const write = (text: string) =>
            expectChange(
              "proj/.msa/skills/y.md",
              value(() => env.writeFile("proj/.msa/skills/y.md", text, context)),
            );
          yield* write("y");
          yield* write("yy");
        }),
      );
    }),
};

const excludedTargets: WatchTarget[] = [
  { path: "skills", recursive: true, exclude: { hidden: true, names: ["node_modules"] } },
];

const excludedEntries: EnvCaseSpec = {
  name: "watch skips excluded entries and reports a rename out of them",
  timeoutMs: watchTimeoutMs,
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("skills", undefined, context));
      yield* watching(env, excludedTargets, ({ changes, expectChange, absolute }) =>
        Effect.gen(function* () {
          yield* value(() => env.writeFile("skills/node_modules/dep/SKILL.md", "dep", context));
          yield* value(() => env.writeFile("skills/.SKILL.md.tmp", "draft", context));
          yield* expectChange(
            "skills/SKILL.md",
            value(() => env.renameFile("skills/.SKILL.md.tmp", "skills/SKILL.md", context)),
          );
          const hidden = [
            yield* absolute("skills/node_modules"),
            yield* absolute("skills/.SKILL.md.tmp"),
          ];
          for (const change of changes) {
            if (!("paths" in change)) continue;
            for (const path of change.paths) {
              assert.ok(
                !hidden.some((excluded) => path === excluded || path.startsWith(excluded)),
                `excluded ${path}`,
              );
            }
          }
        }),
      );
    }),
};

const overlappingTargets: EnvCaseSpec = {
  name: "watch keeps recursive coverage where a non-recursive target overlaps",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("skills/a/one.md", "one", context));
      const targets: WatchTarget[] = [{ path: "skills" }, { path: "skills", recursive: true }];
      yield* watching(env, targets, ({ expectChange }) =>
        expectChange(
          "skills/a/two.md",
          value(() => env.writeFile("skills/a/two.md", "two", context)),
        ),
      );
    }),
};

const replacedDirectory: EnvCaseSpec = {
  name: "watch follows a directory replaced at the same path",
  timeoutMs: watchTimeoutMs,
  test: (env) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("skills/a/x.md", "x", context));
      yield* watching(env, [{ path: "skills", recursive: true }], ({ expectChange }) =>
        Effect.gen(function* () {
          yield* expectChange(
            "skills/a",
            Effect.gen(function* () {
              yield* value(() => env.renameFile("skills/a", "skills-old", context));
              yield* value(() => env.createDir("skills/a", undefined, context));
            }),
          );
          const write = (text: string) =>
            expectChange(
              "skills/a/y.md",
              value(() => env.writeFile("skills/a/y.md", text, context)),
            );
          yield* write("y");
          yield* write("yy");
        }),
      );
    }),
};

const closedWatcher: EnvCaseSpec = {
  name: "watch stops reporting once closed",
  timeoutMs: watchTimeoutMs,
  test: (env, { assert }) =>
    Effect.gen(function* () {
      const changes: WatchChange[] = [];
      const watcher = yield* value(() =>
        env.watch([{ path: "file.txt" }], (change) => changes.push(change), context),
      );
      assert.ok(
        watcher.mode === "native" || watcher.mode === "polling",
        "watcher reports its mode",
      );
      yield* settled(() => watcher.close(context));
      yield* settled(() => watcher.close(context));
      yield* value(() => env.writeFile("file.txt", "x", context));
      yield* Effect.sleep(300);
      assert.deepEqual(changes, []);
    }),
};

export const watchCases: readonly EnvCaseSpec[] = [
  missingFile,
  missingAncestors,
  createdDirectories,
  renamedParent,
  excludedEntries,
  overlappingTargets,
  replacedDirectory,
  closedWatcher,
];

export const watchedSymlink: EnvCaseSpec = {
  name: "watch reports changes to the file a watched symbolic link points to",
  timeoutMs: watchTimeoutMs,
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("data/real.md", "one", context));
      yield* value(() => env.createDir("config", undefined, context));
      const linked = yield* value(() =>
        env.exec([...shell, "ln -s ../data/real.md config/AGENTS.md"], undefined, context),
      );
      assert.strictEqual(linked.exitCode, 0);
      yield* watching(env, [{ path: "config/AGENTS.md" }], ({ expectChange }) =>
        expectChange(
          "config/AGENTS.md",
          value(() => env.writeFile("data/real.md", "two!", context)),
        ),
      );
    }),
};
