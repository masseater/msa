function searchSessionsHint(
  scope:
    | { readonly kind: "task"; readonly taskId: string }
    | { readonly kind: "round"; readonly round: string },
): string {
  const narrowing =
    scope.kind === "task"
      ? `taskIds: [${JSON.stringify(scope.taskId)}] limits it to this task's earlier threads`
      : `rounds: [${JSON.stringify(scope.round)}] limits it to the threads of this round's tasks`;
  return `Use search_sessions to check what the user asked for or decided: ${narrowing}, roles limits it to the kinds of thread you list, and leaving them out searches the rest of the project too.`;
}

const sessionSearchHintModule = { searchSessionsHint };

export default sessionSearchHintModule;
