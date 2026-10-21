declare namespace rpcPromptResponseSupportTypes {
  interface RpcIo {
    outputLines: string[];
    lineHandler: ((line: string) => void) | undefined;
  }

  type ParsedOutputLine = Record<string, unknown>;
}

export type { rpcPromptResponseSupportTypes as default };
