import { dual } from "effect/Function";

import { environmentNames, readEnv, setEnv, unsetEnv } from "./platform.ts";

const restoreValue = (name: string, value: string | undefined): void => {
  if (value === undefined) unsetEnv(name);
  else setEnv(name, value);
};

export const applyIsolatedEnvironment: {
  (agentDir: string): (home: string) => () => void;
  (home: string, agentDir: string): () => void;
} = dual(2, (home: string, agentDir: string): (() => void) => {
  const overrides = { HOME: home, USERPROFILE: home, MSA_CODING_AGENT_DIR: agentDir };
  const previous = new Map<string, string | undefined>();
  for (const name of environmentNames()) {
    if (!name.startsWith("MSA_EVAL_")) continue;
    previous.set(name, readEnv(name));
    unsetEnv(name);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!previous.has(name)) previous.set(name, readEnv(name));
    setEnv(name, value);
  }
  return () => {
    for (const [name, value] of previous) restoreValue(name, value);
  };
});
