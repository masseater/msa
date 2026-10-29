import { NodeServices } from "@effect/platform-node";
import {
  Clock,
  Config,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  ManagedRuntime,
  Path,
  Schema,
} from "effect";
import { expect, it } from "vite-plus/test";

import httpServer from "../../libs/testing/src/http-server.ts";
import testProcess from "./test-process.ts";

const { captureProcess, processRunnerLayer } = testProcess;
const { closeServers, encodeJson, listen } = httpServer;

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const MIN_AGE_MINUTES = 2880;
const MINUTE = 60_000;

type Published = Readonly<
  Record<string, Readonly<Record<string, string>> | "not-found" | "server-error" | "no-response">
>;

const minutesAgo = (now: number, minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(now - minutes * MINUTE));

const RootPackage = Schema.fromJsonString(Schema.Struct({ devEngines: Schema.Unknown }));

const registry = (published: Published) =>
  listen((request, origin) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const time = published[name];
    if (time === undefined || time === "not-found") {
      return Effect.succeed(new Response("{}", { status: 404 }));
    }
    if (time === "server-error") {
      return Effect.succeed(new Response("{}", { status: 500 }));
    }
    if (time === "no-response") {
      return Effect.never;
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

const workspaceYaml = (excludes: ReadonlyArray<string>, minAge: number | undefined) =>
  [
    "packages: []",
    ...(minAge === undefined ? [] : [`minimumReleaseAge: ${minAge}`]),
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

const GH_STUB = [
  "#!/usr/bin/env bash",
  'printf "%s\\n" "$*" >>"$GH_LOG"',
  'case "$1 $2" in',
  '  "issue list") cat "$GH_OPEN_ISSUES" ;;',
  '  "issue create") echo "https://github.invalid/issues/1" ;;',
  "esac",
  "",
].join("\n");

type Fixture = Readonly<{
  excludes: ReadonlyArray<string>;
  locked: ReadonlyArray<string>;
  minAge?: number | undefined;
  openIssues?: ReadonlyArray<Readonly<{ number: number; title: string }>>;
  published: Published;
}>;

const runScript = (script: string, options: Fixture) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-release-age-" });
    const bin = yield* fs.makeTempDirectoryScoped({ prefix: "msa-release-age-bin-" });
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
      workspaceYaml(options.excludes, "minAge" in options ? options.minAge : MIN_AGE_MINUTES),
    );
    yield* fs.writeFileString(path.join(dir, "pnpm-lock.yaml"), lockfileYaml(options.locked));
    yield* fs.writeFileString(path.join(dir, ".npmrc"), `registry=${origin}/\n`);
    const ghLog = path.join(bin, "gh.log");
    const openIssues = path.join(bin, "open-issues.json");
    yield* fs.writeFileString(ghLog, "");
    yield* fs.writeFileString(openIssues, yield* encodeJson(options.openIssues ?? []));
    yield* fs.writeFileString(path.join(bin, "gh"), GH_STUB);
    yield* fs.chmod(path.join(bin, "gh"), 0o755);
    const inherited = yield* Config.String("PATH").pipe(Config.withDefault(""));
    const result = yield* captureProcess({
      args: [path.join(root, ".github/scripts", script)],
      command: "bash",
      cwd: dir,
      env: {
        GH_LOG: ghLog,
        GH_OPEN_ISSUES: openIssues,
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "1",
        GITHUB_SERVER_URL: "https://github.invalid",
        PATH: `${bin}:${inherited}`,
        RELEASE_AGE_FETCH_TIMEOUT: "2",
      },
    });
    const ghCalls = (yield* fs.readFileString(ghLog)).split("\n").filter((line) => line !== "");
    return { ...result, ghCalls };
  }).pipe(Effect.scoped, Effect.ensuring(closeServers));

const runExpired = (options: Fixture) => runScript("release-age-expired.sh", options);

const runIssues = (options: Fixture) => runScript("release-age-issues.sh", options);

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

it("lists a version matched by overlapping entries once, joining the entries", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const time = minutesAgo(now, MIN_AGE_MINUTES * 3);
      const result = yield* runExpired({
        excludes: ["@sc/*", "@sc/x@1.0.0"],
        locked: ["@sc/x@1.0.0"],
        published: { "@sc/x": { "1.0.0": time } },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trimEnd().split("\n")).toEqual([
        `@sc/x@1.0.0\t@sc/*, @sc/x@1.0.0\t${time}`,
      ]);
    }),
  ));

it("creates one issue for a version matched by overlapping entries", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const result = yield* runIssues({
        excludes: ["@sc/*", "@sc/x@1.0.0"],
        locked: ["@sc/x@1.0.0"],
        published: { "@sc/x": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) } },
      });
      expect(result.exitCode).not.toBe(0);
      const created = result.ghCalls.filter((call) => call.startsWith("issue create"));
      expect(created).toHaveLength(1);
      expect(created[0]).toContain("--title release-age: @sc/x@1.0.0 ");
      expect(result.ghCalls.some((call) => call.startsWith("issue edit"))).toBe(false);
    }),
  ));

it("updates the open issue of a still-expired version and closes the one whose version left the exclusions", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const result = yield* runIssues({
        excludes: ["old-pkg@1.0.0"],
        locked: [],
        openIssues: [
          { number: 7, title: "release-age: old-pkg@1.0.0 を minimumReleaseAgeExclude から外す" },
          { number: 8, title: "release-age: gone-pkg@2.0.0 を minimumReleaseAgeExclude から外す" },
        ],
        published: { "old-pkg": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) } },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.ghCalls.some((call) => call.startsWith("issue create"))).toBe(false);
      expect(result.ghCalls.filter((call) => call.startsWith("issue edit 7 "))).toHaveLength(1);
      expect(result.ghCalls.filter((call) => call.startsWith("issue close 8 "))).toHaveLength(1);
      expect(result.ghCalls.some((call) => call.startsWith("issue close 7 "))).toBe(false);
    }),
  ));

it.each(["not-found", "server-error", "no-response"] as const)(
  "fails without listing anything when the registry gives %s for an excluded package",
  (failure) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const result = yield* runExpired({
          excludes: ["broken-pkg@1.0.0", "old-pkg@1.0.0"],
          locked: [],
          published: {
            "broken-pkg": failure,
            "old-pkg": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) },
          },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("broken-pkg");
      }),
    ),
  30_000,
);

it("fails without listing anything when minimumReleaseAge is not set", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const result = yield* runExpired({
        excludes: ["old-pkg@1.0.0"],
        locked: [],
        minAge: undefined,
        published: { "old-pkg": { "1.0.0": minutesAgo(now, MIN_AGE_MINUTES * 3) } },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("minimumReleaseAge");
    }),
  ));
