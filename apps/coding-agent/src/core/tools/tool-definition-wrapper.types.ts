import type extensionsTypesTypes from "../extensions/types.types.ts";

declare namespace toolDefinitionWrapperTypes {
  type ToolContextFactory = (
    toolCallId: string,
    signal: AbortSignal | undefined,
  ) => extensionsTypesTypes.ExtensionToolContext;

  interface CwdFactory<TOptions, TResult> {
    (options?: TOptions): (cwd: string) => TResult;
    (cwd: string, options?: TOptions): TResult;
  }

  interface ConfiguredFactory<TConfig, TOptions, TResult> {
    (config: TConfig, options?: TOptions): (cwd: string) => TResult;
    (cwd: string, config: TConfig, options?: TOptions): TResult;
  }

  interface NamedFactory<TName extends string, TOptions, TResult> {
    (cwd: string, options?: TOptions): (name: TName) => TResult;
    (name: TName, cwd: string, options?: TOptions): TResult;
  }
}

export type { toolDefinitionWrapperTypes as default };
