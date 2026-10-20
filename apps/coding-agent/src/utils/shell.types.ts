declare namespace shellTypes {
  interface ShellConfig {
    shell: string;
    args: string[];
    commandTransport?: "argv" | "stdin";
  }
}

export type { shellTypes as default };
