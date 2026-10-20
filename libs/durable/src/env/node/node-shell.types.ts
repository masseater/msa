declare namespace nodeShellTypes {
  interface ShellConfig {
    shell: string;
    args: string[];
    commandTransport?: "argv" | "stdin";
  }
}

export type { nodeShellTypes as default };
