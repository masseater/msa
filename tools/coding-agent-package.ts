import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

const packageJsonJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

interface PackageInfo {
  readonly packageJsonText: string;
  readonly repoRoot: string;
  readonly version: string;
}

class Workspace extends Context.Service<
  Workspace,
  {
    readonly loadCodingAgentPackage: Effect.Effect<PackageInfo>;
  }
>()("msa-monorepo/tools/coding-agent-package/Workspace") {}

const workspaceLayer: Layer.Layer<Workspace> = Layer.effect(
  Workspace,
  Effect.gen(function* () {
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const fs = yield* FileSystem.FileSystem;
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const path = yield* Path.Path;
    const repoRoot = path.resolve(import.meta.dirname, "..");
    return Workspace.of({
      loadCodingAgentPackage: Effect.gen(function* () {
        const packageJsonText = yield* fs.readFileString(
          path.join(repoRoot, "apps", "coding-agent", "package.json"),
        );
        const { version } = yield* Schema.decodeEffect(packageJsonJson)(packageJsonText);
        if (!VERSION_PATTERN.test(version)) {
          return yield* Effect.die(new Error(`invalid package version: ${version}`));
        }
        return { packageJsonText, repoRoot, version };
      }).pipe(Effect.orDie),
    });
  }),
)
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
  .pipe(Layer.provide(NodeServices.layer));

export type { PackageInfo };
export { Workspace, workspaceLayer };
