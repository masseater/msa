const notSaved = new Map<string, string>();

function markSignInsNotSaved(agentDir: string, notice: string): void {
  notSaved.set(agentDir, notice);
}

function signInsNotSaved(agentDir: string): string | undefined {
  return notSaved.get(agentDir);
}

const mcpSignInStorage = { markSignInsNotSaved, signInsNotSaved };

export default mcpSignInStorage;
