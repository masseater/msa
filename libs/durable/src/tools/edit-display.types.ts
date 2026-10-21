declare namespace editDisplayTypes {
  type EditToolDetails = {
    diff: string;
    patch: string;
    firstChangedLine?: number;
  };
}

export type { editDisplayTypes as default };
