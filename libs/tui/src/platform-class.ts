import { Context, Effect } from "effect";

import type platformFailureTypes from "./platform-failure.types.ts";
import type platformTypes from "./platform.types.ts";

export default class Platform extends Context.Service<
  Platform,
  {
    readonly isDirectory: (path: string) => Effect.Effect<boolean>;
    readonly readDirectory: (
      path: string,
    ) => Effect.Effect<ReadonlyArray<string>, platformFailureTypes.PlatformFailure>;
    readonly runCommand: (
      request: platformTypes.CommandRequest,
    ) => Effect.Effect<platformTypes.CommandResult, platformFailureTypes.PlatformFailure>;
    readonly writeFile: (
      file: platformTypes.FileWrite,
    ) => Effect.Effect<void, platformFailureTypes.PlatformFailure>;
  }
>()("@msa/tui/platform-class/Platform") {}
