declare namespace nodeChildWaitTypes {
  type ChildExit = { code: number | null; signal: NodeJS.Signals | null };
}

export type { nodeChildWaitTypes as default };
