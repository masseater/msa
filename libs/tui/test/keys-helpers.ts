import { dual } from "effect/Function";

import { overrideEnv } from "../src/env.ts";

export const withEnv: {
  (name: string, value: string | undefined, fn: () => void): void;
  (value: string | undefined, fn: () => void): (name: string) => void;
} = dual(3, (name: string, value: string | undefined, fn: () => void): void => {
  const restore = overrideEnv({ [name]: value });
  try {
    fn();
  } finally {
    restore();
  }
});

export const withEnvVars: {
  (vars: Record<string, string | undefined>, fn: () => void): void;
  (fn: () => void): (vars: Record<string, string | undefined>) => void;
} = dual(2, (vars: Record<string, string | undefined>, fn: () => void): void => {
  const entries = Object.entries(vars);
  const run = (index: number): void => {
    if (index >= entries.length) {
      fn();
      return;
    }
    const [name, value] = entries[index]!;
    withEnv(name, value, () => run(index + 1));
  };
  run(0);
});
