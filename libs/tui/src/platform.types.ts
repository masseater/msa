import type platformFailureTypes from "./platform-failure.types.ts";
import type platform from "./platform.ts";

declare namespace platformTypes {
  interface CommandRequest {
    readonly file: string;
    readonly args: ReadonlyArray<string>;
  }

  interface CommandResult {
    readonly exitCode: number;
    readonly stdout: string;
  }

  interface FileWrite {
    readonly path: string;
    readonly data: string;
    readonly append: boolean;
  }

  interface PathOperations {
    readonly join: (...segments: ReadonlyArray<string>) => string;
    readonly dirname: (path: string) => string;
    readonly basename: (path: string, suffix?: string) => string;
    readonly isAbsolute: (path: string) => boolean;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
    readonly toNamespacedPath: (path: string) => string;
  }

  type PlatformFailure = platformFailureTypes.PlatformFailure;

  type Platform = (typeof platform.Platform)["prototype"];
}

export type { platformTypes as default };
