import { dual } from "effect/Function";

export interface CwdFactory<TOptions, TResult> {
  (options?: TOptions): (cwd: string) => TResult;
  (cwd: string, options?: TOptions): TResult;
}

export const cwdFactory = <TOptions, TResult>(
  make: (cwd: string, options?: TOptions) => TResult,
): CwdFactory<TOptions, TResult> => dual((args) => typeof args[0] === "string", make);
