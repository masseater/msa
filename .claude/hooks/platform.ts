import { Context } from "effect";
import type { Effect, Option } from "effect";

type Sink = "stdout" | "stderr";

interface CommandResult {
  readonly succeeded: boolean;
  readonly stdout: string;
  readonly output: string;
}

class HookPlatform extends Context.Service<
  HookPlatform,
  {
    readonly runCommand: (command: string, args: readonly string[]) => Effect.Effect<CommandResult>;
    readonly readStdin: Effect.Effect<string>;
    readonly write: (sink: Sink, text: string) => Effect.Effect<void>;
    readonly exists: (file: string) => Effect.Effect<boolean>;
    readonly readFile: (file: string) => Effect.Effect<Option.Option<string>>;
    readonly resolve: (...segments: readonly string[]) => string;
    readonly join: (...segments: readonly string[]) => string;
    readonly relative: (from: string, to: string) => string;
    readonly sep: string;
  }
>()("claude-harness/hooks/platform/HookPlatform") {}

export { HookPlatform };
export type { CommandResult, Sink };
