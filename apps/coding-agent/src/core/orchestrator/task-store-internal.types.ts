declare namespace taskStoreInternalTypes {
  interface TaskRow {
    id: string;
    project: string;
    round: string;
    kind: string;
    title: string;
    current_state: string;
    goal_state: string;
    checks: string;
    status: string;
    cwd: string;
    merge_into: string | null;
    condition: string | null;
    model: string | null;
    thinking_level: string | null;
    created_at: number;
    updated_at: number;
  }
}

export type { taskStoreInternalTypes as default };
