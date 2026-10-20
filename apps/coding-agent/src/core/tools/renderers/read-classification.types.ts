declare namespace readClassificationTypes {
  interface CompactReadClassification {
    kind: "docs" | "resource" | "skill";
    label: string;
  }
}

export type { readClassificationTypes as default };
