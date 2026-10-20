declare namespace tuiAltScreenHelpersTypes {
  interface RecordedEvents {
    readonly events: ReadonlyArray<
      { type: "write"; data: string } | { type: "start" } | { type: "stop" }
    >;
  }
}

export type { tuiAltScreenHelpersTypes as default };
