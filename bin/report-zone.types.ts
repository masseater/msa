declare namespace reportZoneTypes {
  interface ReportZone {
    readonly day: (ms: number) => string;
    readonly hour: (ms: number) => string;
    readonly week: (ms: number) => string;
  }
}

export type { reportZoneTypes as default };
