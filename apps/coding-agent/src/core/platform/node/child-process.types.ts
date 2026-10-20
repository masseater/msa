import type {
  ChildProcessByStdio as ChildProcessByStdioSource,
  ChildProcess as ChildProcessSource,
  ExecFileException as ExecFileExceptionSource,
  SpawnOptions as SpawnOptionsSource,
  SpawnOptionsWithStdioTuple as SpawnOptionsWithStdioTupleSource,
  SpawnSyncOptionsWithStringEncoding as SpawnSyncOptionsWithStringEncodingSource,
  SpawnSyncReturns as SpawnSyncReturnsSource,
  StdioNull as StdioNullSource,
  StdioPipe as StdioPipeSource,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

declare namespace nodeChildProcessTypes {
  type ChildProcess = ChildProcessSource;
  type ChildProcessByStdio<
    I extends Writable | null,
    O extends Readable | null,
    E extends Readable | null,
  > = ChildProcessByStdioSource<I, O, E>;
  type ExecFileException = ExecFileExceptionSource;
  type SpawnOptions = SpawnOptionsSource;
  type SpawnOptionsWithStdioTuple<
    Stdin extends StdioNullSource | StdioPipeSource,
    Stdout extends StdioNullSource | StdioPipeSource,
    Stderr extends StdioNullSource | StdioPipeSource,
  > = SpawnOptionsWithStdioTupleSource<Stdin, Stdout, Stderr>;
  type SpawnSyncOptionsWithStringEncoding = SpawnSyncOptionsWithStringEncodingSource;
  type SpawnSyncReturns<T> = SpawnSyncReturnsSource<T>;
  type StdioNull = StdioNullSource;
  type StdioPipe = StdioPipeSource;
}

export type { nodeChildProcessTypes as default };
