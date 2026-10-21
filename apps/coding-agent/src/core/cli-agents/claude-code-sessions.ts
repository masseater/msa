import type Session from "./claude-code-session.ts";

const sessions = new Set<Session>();

const claudeCodeSessions = { sessions };

export default claudeCodeSessions;
