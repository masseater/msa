import RemoteRef from "./remote-ref-class.ts";
import remoteRefKit from "./remote-ref-kit.ts";

const { RemoteBinding } = remoteRefKit;

const remoteRef = {
  RemoteBinding: RemoteBinding,
  RemoteRef,
};

export default remoteRef;
