import outputGuard from "../../core/output-guard.ts";
import jsonl from "./jsonl.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { writeRawStdout } = outputGuard;
const { serializeJsonLine } = jsonl;

function runRpcModePart9(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart8();
}

function runRpcModePart8(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart7();
}

function runRpcModePart7(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart6();
}

function runRpcModePart6(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart5();
}

function runRpcModePart5(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart4();
}

function runRpcModePart4(): {
  pendingExtensionRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >;
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  shutdownRequested: boolean;
  unsubscribe: (() => void) | undefined;
  unsubscribeBackpressure: (() => void) | undefined;
  signalCleanupHandlers: (() => void)[];
  success: <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ) => rpcTypesTypes.RpcResponse;
  error: (id: string | undefined, command: string, message: string) => rpcTypesTypes.RpcResponse;
  shuttingDown: boolean;
} {
  return runRpcModePart2();
}

function runRpcModePart2() {
  let unsubscribe: (() => void) | undefined = undefined;
  let { output, unsubscribeBackpressure }: ReturnType<typeof runRpcModePart2Part9> =
    runRpcModePart2Part9();

  const success = <T extends rpcTypesTypes.RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ): rpcTypesTypes.RpcResponse => {
    if (data === undefined) {
      return { command, id, success: true, type: "response" } as rpcTypesTypes.RpcResponse;
    }
    return { command, data, id, success: true, type: "response" } as rpcTypesTypes.RpcResponse;
  };

  const error = (
    id: string | undefined,
    command: string,
    message: string,
  ): rpcTypesTypes.RpcResponse => ({
    command,
    error: message,
    id,
    success: false,
    type: "response",
  });

  const pendingExtensionRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();

  let shutdownRequested = false;
  let shuttingDown = false;
  const signalCleanupHandlers: Array<() => void> = [];
  return {
    error,
    output,
    pendingExtensionRequests,
    shutdownRequested,
    shuttingDown,
    signalCleanupHandlers,
    success,
    unsubscribe,
    unsubscribeBackpressure,
  };
}

function runRpcModePart2Part9(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part8();
}

function runRpcModePart2Part8(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part7();
}

function runRpcModePart2Part7(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part6();
}

function runRpcModePart2Part6(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part5();
}

function runRpcModePart2Part5(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part4();
}

function runRpcModePart2Part4(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part3();
}

function runRpcModePart2Part3(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part2();
}

function runRpcModePart2Part2(): {
  output: (obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object) => void;
  unsubscribeBackpressure: (() => void) | undefined;
} {
  return runRpcModePart2Part1();
}

function runRpcModePart2Part1() {
  let unsubscribeBackpressure: (() => void) | undefined = undefined;

  const output = (
    obj: rpcTypesTypes.RpcResponse | rpcTypesTypes.RpcExtensionUIRequest | object,
  ) => {
    writeRawStdout(serializeJsonLine(obj));
  };
  return { output, unsubscribeBackpressure };
}

const rpcModePart1 = {
  runRpcModePart9,
};

export default rpcModePart1;
