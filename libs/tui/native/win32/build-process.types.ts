import type buildProcess from "./build-process.ts";

declare namespace buildProcessTypes {
  interface Win32Target {
    readonly arch: "x64" | "arm64";
    readonly msvcArch: string;
    readonly mingwTarget: string;
    readonly prefixedCompilers: ReadonlyArray<string>;
    readonly envCompiler: "CC_X64" | "CC_ARM64";
  }

  interface BuildContext {
    readonly scriptDir: string;
    readonly sourceFile: string;
    readonly temporaryDir: string;
  }

  type Win32BuildError = (typeof buildProcess.Win32BuildError)["prototype"];
}

export type { buildProcessTypes as default };
