import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { NodeServices } from "@effect/platform-node";
import { CONFIG_DIR_NAME, getAgentDir } from "@msa/coding-agent";
import { Console, Effect, FileSystem, ManagedRuntime, Option, Path, Schema } from "effect";

export interface SandboxConfig extends SandboxRuntimeConfig {
  enabled?: boolean;
}

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  filesystem: {
    allowWrite: [".", "/tmp"],
    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
    denyWrite: [".env", ".env.*", "*.pem", "*.key"],
  },
  network: {
    allowedDomains: [
      "npmjs.org",
      "*.npmjs.org",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "*.pypi.org",
      "github.com",
      "*.github.com",
      "api.github.com",
      "raw.githubusercontent.com",
    ],
    deniedDomains: [],
  },
};

const parseConfig = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const readConfigFile = (file: string) =>
  Effect.gen(function* () {
    const content = yield* fsService.readFileString(file).pipe(Effect.option);
    if (Option.isNone(content)) return {};
    const parsed = parseConfig(content.value);
    if (Option.isNone(parsed)) {
      yield* Console.error(`Warning: Could not parse ${file}`);
      return {};
    }
    return parsed.value as Partial<SandboxConfig>;
  });

const deepMerge = (base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig => {
  const result: SandboxConfig = { ...base };

  if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
  if (overrides.network !== undefined) {
    result.network = { ...base.network, ...overrides.network };
  }
  if (overrides.filesystem !== undefined) {
    result.filesystem = { ...base.filesystem, ...overrides.filesystem };
  }

  const extendedOverrides = overrides as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
  };
  const extendedResult = result as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
  };

  if (extendedOverrides.ignoreViolations !== undefined) {
    extendedResult.ignoreViolations = extendedOverrides.ignoreViolations;
  }
  if (extendedOverrides.enableWeakerNestedSandbox !== undefined) {
    extendedResult.enableWeakerNestedSandbox = extendedOverrides.enableWeakerNestedSandbox;
  }

  return result;
};

export const loadConfig = (cwd: string): Effect.Effect<SandboxConfig> =>
  Effect.gen(function* () {
    const global = yield* readConfigFile(
      pathService.join(getAgentDir(), "extensions", "sandbox.json"),
    );
    const project = yield* readConfigFile(pathService.join(cwd, CONFIG_DIR_NAME, "sandbox.json"));
    return deepMerge(deepMerge(DEFAULT_CONFIG, global), project);
  });
