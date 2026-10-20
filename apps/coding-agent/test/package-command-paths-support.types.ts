declare namespace packageCommandPathsSupportTypes {
  interface PackageTestState {
    readonly tempDir: string;
    readonly agentDir: string;
    readonly projectDir: string;
    readonly packageDir: string;
    readonly originalCwd: string;
    readonly originalExecPath: string;
    readonly originalAgentDir: string | undefined;
    readonly originalMsaPackageDir: string | undefined;
    readonly originalPath: string | undefined;
    readonly originalExitCode: typeof process.exitCode;
  }
}

export type { packageCommandPathsSupportTypes as default };
