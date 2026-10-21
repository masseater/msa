import type typesModule from "./types.ts";

const getProcessEnv = (): Record<string, string | undefined> | undefined => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env;
};

const defaultProviderAuthContext = (): typesModule.AuthContext => ({
  env(name: string): Promise<string | undefined> {
    const value = getProcessEnv()?.[name];
    return Promise.resolve(
      typeof value === "string" && value.trim().length > 0 ? value : undefined,
    );
  },

  fileExists(): Promise<boolean> {
    return Promise.resolve(false);
  },
});

const context = {
  defaultProviderAuthContext,
};

export default context;
