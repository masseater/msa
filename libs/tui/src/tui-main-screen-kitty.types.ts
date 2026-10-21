declare namespace tuiMainScreenKittyTypes {
  interface LineRange {
    firstChanged: number;
    lastChanged: number;
  }

  interface ChangedRange extends LineRange {
    appendStart: boolean;
  }
}

export type { tuiMainScreenKittyTypes as default };
