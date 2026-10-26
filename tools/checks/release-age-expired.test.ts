import { NodeServices } from "@effect/platform-node";
import { Clock, DateTime, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import httpServer from "../../libs/testing/src/http-server.ts";
import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { closeServers, encodeJson, listen } = httpServer;

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const MIN_AGE_MINUTES = 2880;
const MINUTE = 60_000;

type Published = Readonly<Record<string, Readonly<Record<string, string>>>>;

const minutesAgo = (now: number, minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(now - minutes * MINUTE));

const RootPackage = Schema.fromJsonString(Schema.Struct({ devEngines: Schema.Unknown }));

const registry = (published: Published) =>
  listen((request, origin) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const time = published[name];
    if (time === undefined) {
      return Effect.succeed(new Response("{}", { status: 404 }));
    }
    const versions = Object.fromEntries(
      Object.keys(time).map((version) => [
        version,
        { dist: { tarball: `${origin}/${name}-${version}.tgz` }, name, version },
      ]),
    );
    const latest = Object.keys(time).at(-1) ?? "";
    return encodeJson({ "dist-tags": { latest }, name, time, versions }).pipe(
      Effect.map((body) => new Response(body, { headers: { "content-type": "application/json" } })),
    );
  });

const workspaceYaml = (excludes: ReadonlyArray<string>) =>
  [
    "packages: []",
    `minimumReleaseAge: ${MIN_AGE_MINUTES}`,
    "minimumReleaseAgeExclude:",
    ...excludes.map((entry) => `  - '${entry}'`),
    "",
  ].join("\n");

const lockfileYaml = (locked: ReadonlyArray<string>) =>
  [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .: {}",
    "",
    "packages:",
    "",
    ...locked.flatMap((spec) => [`  '${spec}':`, "    resolution: {integrity: sha512-x}", ""]),
    "snapshots:",
    "",
    ...locked.flatMap((spec) => [`  '${spec}': {}`, ""]),
  ].join("\n");

const runExpired = (
  options: Readonly<{
    excludes: ReadonlyArray<string>;
    locked: ReadonlyArray<string>;
    published: Published;
  }>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-release-age-" });
    const origin = yield* registry(options.published);
    const { devEngines } = yield* Schema.decodeEffect(RootPackage)(
      yield* fs.readFileString(path.join(root, "package.json")),
    );
    yield* fs.writeFileString(
      path.join(dir, "package.json"),
      yield* encodeJson({ devEngines, name: "fixture", private: true }),
    );
    yield* fs.writeFileString(
      path.join(dir, "pnpm-workspace.yaml"),
      workspaceYaml(options.excludes),
    );
    yield* fs.writeFileString(path.join(dir, "pnpm-lock.yaml"), lockfileYaml(options.locked));
    yield* fs.writeFileString(path.join(dir, ".npmrc"), `registry=${origin}/\n`);
    return yield* captureProcess({
      args: [path.join(root, ".github/scripts/release-age-expired.sh")],
      command: "bash",
      cwd: dir,
    });
  }).pipe(Effect.scoped, Effect.ensuring(closeServers));

it("lists the excluded versions published longer ago than minimumReleaseAge, resolving unversioned entries from the lockfile", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const published = {
        "@scope/a": { "3.0.0": minutesAgo(now, MIN_AGE_MINUTES + 5) },
        "@scope/b": { "4.0.0": minutesAgo(now, 60) },
        "old-pkg": {
          "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3),
          "1.1.0": minutesAgo(now, 60),
        },
        "young-pkg": { "2.0.0": minutesAgo(now, MIN_AGE_MINUTES - 5) },
      };
      const result = yield* runExpired({
        excludes: ["old-pkg@1.0.0 || 1.1.0", "young-pkg@2.0.0", "@scope/*"],
        locked: ["@scope/a@3.0.0", "@scope/b@4.0.0", "unlisted@1.0.0"],
        published,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trimEnd().split("\n")).toEqual([
        `@scope/a@3.0.0\t@scope/*\t${published["@scope/a"]["3.0.0"]}`,
        `old-pkg@1.0.0\told-pkg@1.0.0 || 1.1.0\t${published["old-pkg"]["1.0.0"]}`,
      ]);
    }),
  ));

it("fails without listing anything when the registry has no publish time for an excluded version", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const result = yield* runExpired({
        excludes: ["old-pkg@1.0.0", "gone-pkg@9.9.9"],
        locked: [],
        published: {
          "gone-pkg": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) },
          "old-pkg": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) },
        },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("gone-pkg@9.9.9");
    }),
  ));
