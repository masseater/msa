declare namespace nativeModulePathTypes {
  interface NativeModuleCandidateOptions {
    moduleUrl?: string;
    resolvePackage?: (specifier: string) => string;
  }
}

export type { nativeModulePathTypes as default };
