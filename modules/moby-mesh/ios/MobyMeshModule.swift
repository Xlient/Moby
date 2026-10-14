import ExpoModulesCore

// iOS can't put custom data in a Bluetooth advertisement (Core Bluetooth only lets an
// app advertise a name and service UUIDs), so the Android design doesn't carry over.
// The iOS version needs a GATT service instead: see docs/mesh-guide.md, "iOS".
// Until then this reports "unsupported" so the app hides the feature on iPhone.
public class MobyMeshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MobyMesh")
    Events("onPacket", "onError", "onStateChange")

    Function("getState") { () -> [String: Any] in
      return ["supported": false, "enabled": false, "reason": "ios_not_implemented"]
    }
    AsyncFunction("startScanning") { () in }
    Function("stopScanning") { () in }
    AsyncFunction("advertise") { (_: [Int]) in }
    Function("stopAdvertising") { () in }
  }
}
