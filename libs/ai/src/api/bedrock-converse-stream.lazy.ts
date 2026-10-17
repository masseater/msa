import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

const importNodeOnlyApi = (specifier: string): Promise<unknown> => {
  const runtimeSpecifier = import.meta.url.endsWith(".js")
    ? specifier.replace(/\.ts$/u, ".js")
    : specifier;
  return import(runtimeSpecifier);
};

let bedrockModuleOverride: ProviderStreams | undefined;

export function setBedrockProviderModule(module: ProviderStreams): void {
  bedrockModuleOverride = module;
}

export const bedrockConverseStreamApi = (): ProviderStreams =>
  lazyApi(() =>
    bedrockModuleOverride === undefined
      ? importNodeOnlyApi("./bedrock-converse-stream.ts").then(
          (module) => module as ProviderStreams,
        )
      : Promise.resolve(bedrockModuleOverride),
  );
