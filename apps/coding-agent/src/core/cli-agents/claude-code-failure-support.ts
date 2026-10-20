const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const claudeCodeFailureSupport = {
  failureMessage,
};

export default claudeCodeFailureSupport;
