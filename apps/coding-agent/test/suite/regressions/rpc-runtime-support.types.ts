import type { Mock } from "vite-plus/test";

declare namespace rpcRuntimeSupportTypes {
  interface OutputGuardModule {
    default: {
      flushRawStdout: Mock<() => Promise<void>>;
      takeOverStdout: Mock<() => void>;
      waitForRawStdoutBackpressure: Mock<() => Promise<void>>;
      writeRawStdout: (line: string) => void;
    };
  }

  interface JsonlModule {
    default: {
      attachJsonlLineReader: Mock<
        (stream: NodeJS.ReadableStream, onLine: (line: string) => void) => () => void
      >;
      serializeJsonLine: (value: unknown) => string;
    };
  }
}

export type { rpcRuntimeSupportTypes as default };
