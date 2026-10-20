declare namespace storageDiskFootprintTypes {
  type DiskFootprint =
    | {
        readonly kind: "sqlite";
        readonly mainBytes: number;
        readonly auxiliaryBytes: number;
        readonly fileCount: number;
        readonly pageCount: number;
        readonly freelistCount: number;
      }
    | {
        readonly kind: "jsonl";
        readonly mainBytes: number;
        readonly auxiliaryBytes: number;
        readonly fileCount: number;
        readonly documentFiles: number;
        readonly taskFiles: number;
      };
}

export type { storageDiskFootprintTypes as default };
