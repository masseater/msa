declare namespace envNodeSupportTypes {
  interface NodeFileHandle {
    readonly fd: number;
    sync(): Promise<void>;
    read(...args: unknown[]): Promise<unknown>;
    close(): Promise<void>;
  }
}

export type { envNodeSupportTypes as default };
