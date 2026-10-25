import { Config, ConfigProvider, Effect } from "effect";

const localLlmTestsEnabled = Config.String("MSA_LOCAL_LLM_TESTS").pipe(
  Config.withDefault(""),
  Config.map((value) => value !== ""),
);

const localLlmTests: boolean = Effect.runSync(
  localLlmTestsEnabled.parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
);

const localLlm = { localLlmTests };

export default localLlm;
