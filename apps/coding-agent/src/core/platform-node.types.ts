declare namespace platformNodeTypes {
  interface ParsedPath {
    readonly root: string;
    readonly dir: string;
    readonly base: string;
    readonly ext: string;
    readonly name: string;
  }
}

export type { platformNodeTypes as default };
