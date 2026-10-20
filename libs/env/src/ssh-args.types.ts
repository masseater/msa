declare namespace sshArgsTypes {
  interface SshTarget {
    host: string;
    user?: string;
    port?: number;
    identityFile?: string;
    knownHostsFile: string;
    hostKeyAlias: string;
    ssh?: string;
    configFile?: string;
  }

  interface SshArgumentOptions {
    readonly strictHostKeys: boolean;
    readonly knownHostsFile: string;
  }
}

export type { sshArgsTypes as default };
