declare namespace describeTypes {
  type CodemodeNamespace = {
    readonly name: string;
    readonly description?: string;
    readonly instructions?: string;
    readonly prefix: string;
  };
}

export type { describeTypes as default };
