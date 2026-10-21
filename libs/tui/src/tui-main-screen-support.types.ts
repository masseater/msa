import type tuiMainScreenSupport from "./tui-main-screen-support.ts";

declare namespace tuiMainScreenSupportTypes {
  interface RenderCrash {
    readonly directory: string | undefined;
    readonly lines: readonly string[];
    readonly message: (crashLogPath: string) => string;
  }

  type BoundedTerminalWriter = (typeof tuiMainScreenSupport.BoundedTerminalWriter)["prototype"];
}

export type { tuiMainScreenSupportTypes as default };
