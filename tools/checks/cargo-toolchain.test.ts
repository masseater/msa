import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import viteConfig from "../../vite.config.ts";

const TOOLCHAIN_FILE = "rust-toolchain.toml";
const PACKAGE_GROUPS = ["apps", "apps/coding-agent/examples/extensions", "libs", "infra", "tools"];
const CARGO = /(?:^|[\s;&|])cargo\s/u;
const LEADING_CD = /^cd\s+(\S+)\s*&&\s*/u;

const Manifest = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
);

interface CargoRun {
  readonly command: string;
  readonly cwd: string;
  readonly origin: string;
}

const taskRuns = (root: string, path: Path.Path): ReadonlyArray<CargoRun> =>
  Object.entries(viteConfig.run?.tasks ?? {}).flatMap(([name, task]) => {
    if (task === undefined || typeof task === "string" || Array.isArray(task)) return [];
    const commands = Array.isArray(task.command) ? task.command : [task.command];
    return commands.map((command) => ({
      command: String(command),
      cwd: path.resolve(root, task.cwd ?? "."),
      origin: `task ${name}`,
    }));
  });

const scriptRuns = (dir: string, origin: string, scripts: Readonly<Record<string, string>>) =>
  Object.entries(scripts).map(([name, script]) => {
    const cd = LEADING_CD.exec(script);
    return {
      command: cd === null ? script : script.slice(cd[0].length),
      cwd: cd?.[1] === undefined ? dir : `${dir}/${cd[1]}`,
      origin: `${origin} script ${name}`,
    };
  });

const collectRuns = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const children = yield* Effect.forEach(PACKAGE_GROUPS, (group) =>
    Effect.gen(function* () {
      const dir = path.join(root, group);
      if (!(yield* fs.exists(dir))) return [];
      return (yield* fs.readDirectory(dir)).map((name) => path.join(dir, name));
    }),
  );
  const dirs = [root, path.join(root, ".claude"), ...children.flat()];
  const manifests = yield* Effect.forEach(dirs, (dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "package.json");
      if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return [];
      const manifest = yield* Schema.decodeEffect(Manifest)(yield* fs.readFileString(file));
      return scriptRuns(dir, path.relative(root, file) || "package.json", manifest.scripts ?? {});
    }),
  );
  const runs = [...taskRuns(root, path), ...manifests.flat()].filter((run) =>
    CARGO.test(run.command),
  );
  const problems = yield* Effect.forEach(runs, (run) =>
    Effect.gen(function* () {
      const pinned = yield* fs.exists(path.join(run.cwd, TOOLCHAIN_FILE));
      return [
        ...(run.command.includes("--manifest-path")
          ? [`${run.origin}: --manifest-path skips ${TOOLCHAIN_FILE}; run cargo in the crate`]
          : []),
        ...(pinned ? [] : [`${run.origin}: runs cargo where there is no ${TOOLCHAIN_FILE}`]),
      ];
    }),
  );
  return { problems: problems.flat(), runs };
});

const runtime = ManagedRuntime.make(NodeServices.layer);

it(`runs every cargo command in a directory whose ${TOOLCHAIN_FILE} pins the toolchain`, () =>
  runtime.runPromise(
    collectRuns.pipe(
      Effect.tap(({ problems, runs }) =>
        Effect.sync(() => {
          expect(runs).not.toEqual([]);
          expect(problems).toEqual([]);
        }),
      ),
    ),
  ));
