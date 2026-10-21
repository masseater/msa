import type DefaultPackageManager from "../default-package-manager.ts";
import AutoDiscoveredResources from "./auto-discovered-resources.ts";
import ManifestResources from "./manifest-resources.ts";
import PackageSourceResources from "./package-source-resources.ts";
import ResourceCollection from "./resource-collection.ts";

export default class PackageResources {
  readonly packages: PackageSourceResources;
  readonly collection: ResourceCollection;
  readonly manifest: ManifestResources;
  readonly autoDiscovery: AutoDiscoveredResources;

  constructor(manager: DefaultPackageManager) {
    this.packages = new PackageSourceResources(manager);
    this.collection = new ResourceCollection(manager);
    this.manifest = new ManifestResources(manager);
    this.autoDiscovery = new AutoDiscoveredResources(manager);
  }
}
