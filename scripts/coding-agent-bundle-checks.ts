import { isBuiltin } from "node:module";

import { Effect, Schema } from "effect";
import type { Metafile } from "esbuild";

import codingAgentBundleOptions from "./coding-agent-bundle-options.ts";
import type hostTypes from "./host.types.ts";

const { ALLOWED_EXTERNAL_PACKAGES } = codingAgentBundleOptions;

class BundleError extends Schema.TaggedError<BundleError, { readonly brand: unique symbol }>()(
  "BundleError",
  { message: Schema.String },
) {}

type Output = Metafile["outputs"][string];

const CLASS_GUARD_INPUT = "/apps/coding-agent/dist/core/platform/node/class-seal";

const TUI_INPUTS = ["/libs/tui/", "/node_modules/@msa/tui/"] as const;

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
        BundleError.make({
          message: `Bundle left unexpected external imports: ${[...unexpected].sort().join(", ")}`,
        }),
      )
    : Effect.void;
};

const refuseInputs = (output: Output, fragments: readonly string[], message: string) => {
  const found = Object.keys(output.inputs).filter((input) => {
    const normalized = `/${input.replaceAll("\\", "/")}`;
    return fragments.some((fragment) => normalized.includes(fragment));
  });
  return found.length > 0
    ? Effect.fail(
        BundleError.make({
          message: `${message}: ${found.length} inputs, ${found.slice(0, 3).join(", ")}`,
        }),
      )
    : Effect.void;
};

const checkImageResizeWorker = (metafile: Metafile) =>
  Effect.forEach(
    Object.values(metafile.outputs).filter((output) =>
      (output.entryPoint ?? "").replaceAll("\\", "/").endsWith("utils/image-resize-worker.js"),
    ),
    (output) => refuseInputs(output, TUI_INPUTS, "Image resize worker must not bundle @msa/tui"),
  );

const checkCodemodeWorker = (host: hostTypes.HostShape, repoRoot: string, metafile: Metafile) =>
  Effect.forEach(Object.entries(metafile.outputs), ([outputPath, output]) =>
    Effect.gen(function* () {
      yield* refuseInputs(
        output,
        [CLASS_GUARD_INPUT, ...TUI_INPUTS],
        "Codemode worker must not bundle the class guard or @msa/tui",
      );
      const invalid = output.imports.filter(
        (imported) => imported.kind !== "import-statement" || !isBuiltin(imported.path),
      );
      if (invalid.length > 0) {
        return yield* BundleError.make({
          message: `Codemode worker must only import Node builtins: ${invalid.map((imported) => imported.path).join(", ")}`,
        });
      }
      const contents = yield* host.readText(host.resolve(repoRoot, outputPath));
      if (contents.includes("import.meta")) {
        return yield* BundleError.make({ message: "Codemode worker must not use import.meta" });
      }
    }),
  );

const codingAgentBundleChecks = {
  BundleError,
  checkCodemodeWorker,
  checkImageResizeWorker,
  validateExternalImports,
};

export default codingAgentBundleChecks;
