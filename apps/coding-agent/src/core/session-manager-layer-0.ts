import type sessionManagerTypes from "./session-manager.types.ts";

export default abstract class SessionManagerLayer0 {
  protected sessionId: string = "";
  protected sessionFile!: string | undefined;
  protected sessionDir!: string;
  cwd!: string;
  protected persist!: boolean;
  protected flushed: boolean = false;
  protected fileEntries: sessionManagerTypes.FileEntry[] = [];
  protected byId: Map<string, sessionManagerTypes.SessionEntry> = new Map();
  protected labelsById: Map<string, string> = new Map();
  protected labelTimestampsById: Map<string, string> = new Map();
  protected leafId: string | null = null;
}
