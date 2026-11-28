import { Config, Effect } from "effect";

const globalToolsPath = Config.String("PATH").pipe(
  Config.withDefault(""),
  Effect.map((value) =>
    value
      .split(":")
      .filter((entry) => !entry.includes("node_modules/.bin"))
      .join(":"),
  ),
);

const globalToolsPathModule = { globalToolsPath };

export default globalToolsPathModule;
