import { Data } from "effect";

class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
  readonly code?: number;
}> {}

const SignalShutdownExtensionCleanupSupport = {
  ProcessExitError,
};

export default SignalShutdownExtensionCleanupSupport;
