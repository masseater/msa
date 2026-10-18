import { isBuiltin } from "node:module";

import { Console, Data, Effect } from "effect";
import { build } from "esbuild";
import type { Metafile } from "esbuild";

import { ALLOWED_EXTERNAL_PACKAGES, commonBuildOptions } from "./coding-agent-bundle-options.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";

const CLI_MODE = 0o755;

const OAUTH_IMPORT = /importOAuthModule\("\.\/([^"]+)\.ts"\)/gu;

const CLI_LAUNCHER = `#!/usr/bin/env node
import { createRequire, enableCompileCache } from "node:module";

enableCompileCache();
createRequire(import.meta.url)("./cli-runtime.js");
`;

class BundleError extends Data.TaggedError("BundleError")<{ readonly message: string }> {}

interface Layout {
  readonly aiDistDir: string;
  readonly bundleDir: string;
  readonly codingAgentDistDir: string;
  readonly repoRoot: string;
}

const layoutOf = (host: HostShape): Layout => {
  const repoRoot = host.resolve(import.meta.dirname, "..");
  const codingAgentDistDir = host.join(repoRoot, "apps", "coding-agent", "dist");
  return {
    aiDistDir: host.join(repoRoot, "libs", "ai", "dist"),
    bundleDir: host.join(codingAgentDistDir, "bundle"),
    codingAgentDistDir,
    repoRoot,
  };
};

const runBuild = (options: Parameters<typeof build>[0]) =>
  Effect.tryPromise({
    try: () => build(options),
    catch: (cause) => new BundleError({ message: `esbuild failed: ${String(cause)}` }),
  });

const metafileOf = (result: { readonly metafile?: Metafile | undefined }) =>
  result.metafile === undefined
    ? Effect.fail(new BundleError({ message: "esbuild did not return a metafile" }))
    : Effect.succeed(result.metafile);

const unexpectedExternal = (path: string, external: boolean | undefined): boolean =>
  external === true && !isBuiltin(path) && !ALLOWED_EXTERNAL_PACKAGES.has(path);

const validateExternalImports = (metafiles: ReadonlyArray<Metafile>) => {
  const unexpected = new Set(
    metafiles.flatMap((metafile) =>
      Object.values(metafile.inputs).flatMap((input) =>
        input.imports
          .filter((imported) => unexpectedExternal(imported.path, imported.external))
          .map((imported) => imported.path),
      ),
    ),
  );
  return unexpected.size > 0
    ? Effect.fail(
        new BundleError({
          message: `Bundle left unexpected external imports: ${[...unexpected].sort().join(", ")}`,
        }),
      )
    : Effect.void;
};

const findContainingOutput = (options: {
  readonly host: HostShape;
  readonly inputSuffix: string;
  readonly metafile: Metafile;
  readonly repoRoot: string;
}) => {
  const normalizedSuffix = options.inputSuffix.replaceAll("\\", "/");
  for (const [outputPath, output] of Object.entries(options.metafile.outputs)) {
    const hit = Object.keys(output.inputs).some((inputPath) =>
      inputPath.replaceAll("\\", "/").endsWith(normalizedSuffix),
    );
    if (hit) return Effect.succeed(options.host.resolve(options.repoRoot, outputPath));
  }
  return Effect.fail(
    new BundleError({
      message: `Could not locate bundled output containing ${options.inputSuffix}`,
    }),
  );
};

const outputBytes = (metafiles: ReadonlyArray<Metafile>): number =>
  metafiles.reduce(
    (total, metafile) =>
      total +
      Object.values(metafile.outputs).reduce((subtotal, output) => subtotal + output.bytes, 0),
    0,
  );

const requireInputs = (host: HostShape, layout: Layout) =>
  Effect.forEach(
    [
      host.join(layout.codingAgentDistDir, "cli.js"),
      host.join(layout.codingAgentDistDir, "index.js"),
      host.join(layout.codingAgentDistDir, "rpc-entry.js"),
      host.join(layout.codingAgentDistDir, "utils", "image-resize-worker.js"),
      host.join(layout.codingAgentDistDir, "extensions", "codemode", "worker.js"),
      host.join(layout.aiDistDir, "auth", "oauth", "anthropic.js"),
    ],
    (entry) =>
      Effect.gen(function* () {
        if (yield* host.exists(entry)) return;
        return yield* new BundleError({
          message: `Bundle input is missing: ${host.relative(layout.repoRoot, entry)}. Build the workspace packages first.`,
        });
      }),
  );

const lazyEntryPointsOf = (host: HostShape, layout: Layout): Record<string, string> => ({
  anthropic: host.join(layout.aiDistDir, "auth", "oauth", "anthropic.js"),
  "image-resize-worker": host.join(layout.codingAgentDistDir, "utils", "image-resize-worker.js"),
  "openai-chatgpt": host.join(layout.aiDistDir, "auth", "oauth", "openai-chatgpt.js"),
  "openai-codex": host.join(layout.aiDistDir, "auth", "oauth", "openai-codex.js"),
  openrouter: host.join(layout.aiDistDir, "auth", "oauth", "openrouter.js"),
  radius: host.join(layout.aiDistDir, "auth", "oauth", "radius.js"),
});

const requireOAuthEntries = (
  host: HostShape,
  layout: Layout,
  lazyEntryPoints: Record<string, string>,
) =>
  Effect.gen(function* () {
    const source = yield* host.readText(
      host.join(layout.repoRoot, "libs", "ai", "src", "auth", "oauth", "load.ts"),
    );
    for (const match of source.matchAll(OAUTH_IMPORT)) {
      const flow = match[1];
      if (flow !== undefined && !(flow in lazyEntryPoints)) {
        return yield* new BundleError({
          message: `OAuth flow "${flow}" is lazily imported but has no lazy bundle entry`,
        });
      }
    }
  });

const checkCodemodeWorker = (host: HostShape, layout: Layout, metafile: Metafile) =>
  Effect.forEach(Object.entries(metafile.outputs), ([outputPath, output]) =>
    Effect.gen(function* () {
      const invalid = output.imports.filter(
        (imported) => imported.kind !== "import-statement" || !isBuiltin(imported.path),
      );
      if (invalid.length > 0) {
        return yield* new BundleError({
          message: `Codemode worker must only import Node builtins: ${invalid.map((imported) => imported.path).join(", ")}`,
        });
      }
      const contents = yield* host.readText(host.resolve(layout.repoRoot, outputPath));
      if (contents.includes("import.meta")) {
        return yield* new BundleError({ message: "Codemode worker must not use import.meta" });
      }
    }),
  );

const sameDirectory = (host: HostShape, left: string, right: string, message: string) =>
  host.dirname(left) === host.dirname(right)
    ? Effect.void
    : Effect.fail(new BundleError({ message }));

const buildMain = (host: HostShape, layout: Layout) =>
  Effect.gen(function* () {
    return yield* metafileOf(
      yield* runBuild({
        ...commonBuildOptions(layout.repoRoot),
        entryNames: "[name]",
        entryPoints: {
          "cli-runtime": host.join(layout.codingAgentDistDir, "cli.js"),
          index: host.join(layout.codingAgentDistDir, "index.js"),
          "rpc-entry": host.join(layout.codingAgentDistDir, "rpc-entry.js"),
        },
        outdir: layout.bundleDir,
        chunkNames: "chunks/[name]-[hash]",
        splitting: true,
      }),
    );
  });

const buildLazy = (host: HostShape, layout: Layout, lazyDir: string) =>
  Effect.gen(function* () {
    const lazyEntryPoints = lazyEntryPointsOf(host, layout);
    yield* requireOAuthEntries(host, layout, lazyEntryPoints);
    return yield* metafileOf(
      yield* runBuild({
        ...commonBuildOptions(layout.repoRoot),
        entryNames: "[name]",
        entryPoints: lazyEntryPoints,
        outdir: lazyDir,
        splitting: false,
      }),
    );
  });

const buildCodemodeWorker = (host: HostShape, layout: Layout, lazyDir: string) =>
  Effect.gen(function* () {
    const metafile = yield* metafileOf(
      yield* runBuild({
        ...commonBuildOptions(layout.repoRoot),
        banner: undefined,
        entryNames: "[name]",
        entryPoints: {
          "codemode-worker": host.join(
            layout.codingAgentDistDir,
            "extensions",
            "codemode",
            "worker.js",
          ),
        },
        outdir: lazyDir,
        splitting: false,
      }),
    );
    yield* checkCodemodeWorker(host, layout, metafile);
    return metafile;
  });

const finish = (host: HostShape, layout: Layout, metafiles: ReadonlyArray<Metafile>) =>
  Effect.gen(function* () {
    yield* validateExternalImports(metafiles);
    const cliPath = host.join(layout.bundleDir, "cli.js");
    yield* host.writeText(cliPath, CLI_LAUNCHER);
    yield* host.chmod(cliPath, CLI_MODE);
    yield* host.chmod(host.join(layout.bundleDir, "rpc-entry.js"), CLI_MODE);
    const files = new Set(metafiles.flatMap((metafile) => Object.keys(metafile.outputs))).size + 1;
    const mib = (outputBytes(metafiles) + CLI_LAUNCHER.length) / (1024 * 1024);
    yield* Console.log(
      `Built ${host.relative(layout.repoRoot, layout.bundleDir)} (${files} files, ${mib.toFixed(1)} MiB)`,
    );
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const layout = layoutOf(host);
  yield* requireInputs(host, layout);
  yield* host.remove(layout.bundleDir);
  yield* host.makeDirectory(layout.bundleDir);
  const mainMetafile = yield* buildMain(host, layout);
  const locate = (inputSuffix: string) =>
    findContainingOutput({ host, inputSuffix, metafile: mainMetafile, repoRoot: layout.repoRoot });
  const oauthLoaderOutput = yield* locate("libs/ai/dist/auth/oauth/load.js");
  const imageResizeOutput = yield* locate("apps/coding-agent/dist/utils/image-resize.js");
  const configOutput = yield* locate("apps/coding-agent/dist/config.js");

  const lazyDir = host.dirname(oauthLoaderOutput);
  const lazyMetafile = yield* buildLazy(host, layout, lazyDir);
  const codemodeMetafile = yield* buildCodemodeWorker(host, layout, lazyDir);

  yield* sameDirectory(
    host,
    imageResizeOutput,
    host.resolve(lazyDir, "image-resize-worker.js"),
    "Image resize implementation and worker were emitted into different directories",
  );
  yield* sameDirectory(
    host,
    configOutput,
    oauthLoaderOutput,
    "config.ts and the codemode worker were emitted into different directories",
  );

  yield* finish(host, layout, [mainMetafile, lazyMetafile, codemodeMetafile]);
});

runScript(program);
