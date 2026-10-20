import * as Effect from "effect/Effect";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";

import json from "../utils/json.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import awaitingModule from "./awaiting.ts";
import modelConfigSupport from "./model-config-support.ts";
import type modelConfigTypes from "./model-config.types.ts";
import nodeFsPromises from "./platform/node/fs-promises.ts";

const { readFile } = nodeFsPromises;
const { awaited, awaiting } = awaitingModule;
const { normalizePath } = paths;
const { stripJsonComments } = json;
const { stripBom } = text;
const { ModelsConfigSchema } = modelConfigSupport;

const validateModelsConfig = Compile(ModelsConfigSchema);
function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === "required") {
    const requiredProperties = (error.params as { requiredProperties?: string[] })
      .requiredProperties;
    const requiredProperty = requiredProperties?.[0];
    if (requiredProperty !== undefined && requiredProperty !== "") {
      const basePath = error.instancePath.replace(/^\//u, "").replace(/\//gu, ".");
      return basePath === "" ? requiredProperty : `${basePath}.${requiredProperty}`;
    }
  }
  const path = error.instancePath.replace(/^\//u, "").replace(/\//gu, ".");
  return path || "root";
}
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
export default class ModelConfig {
  private readonly providers: ReadonlyMap<string, modelConfigTypes.ModelsJsonProvider>;
  private readonly error: string | undefined;

  private constructor(
    providers: ReadonlyMap<string, modelConfigTypes.ModelsJsonProvider>,
    error?: string,
  ) {
    this.providers = providers;
    this.error = error;
  }

  static load(modelsJsonPath: string | undefined): Promise<ModelConfig> {
    return Effect.runPromise(
      awaiting(function* () {
        if (modelsJsonPath === undefined || modelsJsonPath === "")
          return new ModelConfig(new Map());
        const path = normalizePath(modelsJsonPath);
        let content: string;
        try {
          content = yield* awaited(readFile(path, "utf-8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return new ModelConfig(new Map());
          return new ModelConfig(
            new Map(),
            `Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${path}`,
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(stripJsonComments(stripBom(content)));
        } catch (error) {
          return new ModelConfig(
            new Map(),
            `Failed to parse models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${path}`,
          );
        }

        if (!validateModelsConfig.Check(parsed)) {
          const errors =
            validateModelsConfig
              .Errors(parsed)
              .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
              .join("\n") || "Unknown schema error";
          return new ModelConfig(
            new Map(),
            `Invalid models.json schema:\n${errors}\n\nFile: ${path}`,
          );
        }

        const providers = new Map<string, modelConfigTypes.ModelsJsonProvider>();
        for (const [providerId, provider] of Object.entries(parsed.providers)) {
          providers.set(providerId, deepFreeze(structuredClone(provider)));
        }
        return new ModelConfig(providers);
      }),
    );
  }

  getProvider(providerId: string): modelConfigTypes.ModelsJsonProvider | undefined {
    return this.providers.get(providerId);
  }

  getProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  getError(): string | undefined {
    return this.error;
  }
}
