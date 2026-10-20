import type { PhotonImage as PhotonImageTypeSource } from "@silvia-odwyer/photon-node";

declare namespace photonTypes {
  type PhotonImageType = PhotonImageTypeSource;
}

export type { photonTypes as default };
