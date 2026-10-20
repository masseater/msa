declare namespace sshOperationsTypes {
  interface RemotePaths {
    readonly remote: string;
    readonly remoteCwd: string;
    readonly localCwd: string;
  }
}

export type { sshOperationsTypes as default };
