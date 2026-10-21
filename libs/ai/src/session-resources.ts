import type sessionResourcesTypes from "./session-resources.types.ts";

const sessionResourceCleanups = new Set<sessionResourcesTypes.SessionResourceCleanup>();

function registerSessionResourceCleanup(
  cleanup: sessionResourcesTypes.SessionResourceCleanup,
): () => void {
  sessionResourceCleanups.add(cleanup);
  return () => {
    sessionResourceCleanups.delete(cleanup);
  };
}

function cleanupSessionResources(sessionId?: string): void {
  const errors: unknown[] = [];
  for (const cleanup of sessionResourceCleanups) {
    try {
      cleanup(sessionId);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to cleanup session resources");
  }
}

const sessionResources = {
  cleanupSessionResources,
  registerSessionResourceCleanup,
};

export default sessionResources;
