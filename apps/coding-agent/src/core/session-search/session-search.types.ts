declare namespace sessionSearchTypes {
  type PartKind = "user" | "assistant" | "tool_call" | "tool_result";

  type SessionRole = "orchestrator" | "worker" | "reviewer" | "triage" | "advisor" | "session";

  interface Part {
    readonly kind: PartKind;
    readonly tool: string | null;
    readonly text: string;
  }

  interface ThreadLink {
    readonly threadId: string;
    readonly roles: readonly string[];
    readonly taskIds: readonly string[];
    readonly rounds: readonly string[];
  }

  interface Filters {
    readonly kinds?: readonly PartKind[] | undefined;
    readonly tools?: readonly string[] | undefined;
    readonly roles?: readonly SessionRole[] | undefined;
    readonly taskIds?: readonly string[] | undefined;
    readonly threadIds?: readonly string[] | undefined;
    readonly rounds?: readonly string[] | undefined;
    readonly cwd?: string | undefined;
    readonly since?: number | undefined;
    readonly until?: number | undefined;
  }

  interface SessionInfo {
    readonly path: string;
    readonly sessionId: string | null;
    readonly cwd: string | null;
    readonly startedAt: number | null;
    readonly role: SessionRole;
    readonly link: ThreadLink | undefined;
  }

  interface Hit {
    readonly session: SessionInfo;
    readonly kind: PartKind;
    readonly tool: string | null;
    readonly entryId: string | null;
    readonly at: number | null;
    readonly part: number;
    readonly snippet: string;
  }

  interface IndexUpdate {
    readonly files: number;
    readonly changedFiles: number;
    readonly removedFiles: number;
    readonly parts: number;
    readonly skipped: readonly SkippedFile[];
  }

  type IndexState = "intact" | "stale" | "newer";

  interface SkippedFile {
    readonly path: string;
    readonly reason: string;
  }

  interface FileRow {
    id: number;
    path: string;
    size: number;
    mtime: number;
    indexed: number;
    tail: Uint8Array;
  }

  interface SessionHeader {
    sessionId: string;
    cwd: string;
    startedAt: number | null;
  }

  interface PartRow {
    offset: number;
    length: number;
    part: number;
    kind: PartKind;
    tool: string | null;
    entryId: string | null;
    at: number | null;
    body: string;
  }

  interface FileUpdate {
    path: string;
    size: number;
    mtime: number;
    from: number;
    indexed: number;
    tail: Uint8Array;
    header: SessionHeader | undefined;
    orchestrator: boolean;
    parts: readonly PartRow[];
    failure: string | undefined;
  }

  type Order = "relevance" | "newest" | "oldest";

  interface Located {
    readonly session: SessionInfo;
    readonly kind: PartKind;
    readonly tool: string | null;
    readonly entryId: string | null;
    readonly at: number | null;
    readonly part: number;
    readonly offset: number;
    readonly length: number;
  }

  interface EntryRow {
    offset: number;
    length: number;
    entry_id: string | null;
  }

  interface EntryBlock {
    readonly entryId: string | null;
    readonly text: string;
  }

  interface Page {
    readonly text: string;
    readonly next: { readonly entry: string; readonly from: number } | undefined;
  }

  interface SearchRequest {
    readonly query: string;
    readonly filters: Filters;
    readonly order: Order;
    readonly limit: number;
  }

  interface ReadRequest {
    readonly path: string;
    readonly entry: string;
    readonly before: number;
    readonly after: number;
    readonly from: number;
  }

  interface ReadEntry {
    readonly entryId: string | null;
    readonly at: number | null;
    readonly parts: readonly Part[];
  }

  interface Locations {
    readonly indexPath: string;
    readonly roots: readonly string[];
    readonly orchestratorDatabase: string;
  }
}

export type { sessionSearchTypes as default };
