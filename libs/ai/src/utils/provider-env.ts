import { Function } from "effect";

import type typesModule from "../types.types.ts";
import envModule from "./env.ts";

const { readProcessEnv } = envModule;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

const getProviderEnvValue: {
  (env?: typesModule.ProviderEnv): (name: string) => string | undefined;
  (name: string, env?: typesModule.ProviderEnv): string | undefined;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (name: string, env?: typesModule.ProviderEnv): string | undefined =>
    nonEmpty(env?.[name]) ??
    nonEmpty(typeof process === "undefined" ? undefined : readProcessEnv(name)),
);

const providerEnv = {
  getProviderEnvValue,
};

export default providerEnv;
