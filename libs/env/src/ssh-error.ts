import { Data } from "effect";

export default class SshError extends Data.TaggedError("SshError")<{
  readonly message: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}> {
  constructor(message: string, exitCode: number | null, stderr: string) {
    super({ exitCode, message, stderr });
  }
}
