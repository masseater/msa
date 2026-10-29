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
    closed_by?: string | null;
    cwd: string;
    merge_into: string | null;
    opens_pull_request?: number;
    condition: string | null;
    model: string | null;
    thinking_level: string | null;
    created_at: number;
    updated_at: number;
  }
}

export type { taskStoreInternalTypes as default };
