package expo.modules.mobymesh

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Moby's Bluetooth mesh radio, Android side. Deliberately small: it only
//   - advertises one 24-byte packet at a time (JS rotates through what to send), and
//   - listens for other phones' packets and hands the raw bytes to JS.
// Everything else (format, duplicates, hop limits, uploads) is plain TypeScript in
// src/mesh/, where it's unit-tested. See docs/mesh-guide.md.
//
// Packets ride in the manufacturer-specific data of a non-connectable advertisement:
// no pairing, no connection, any number of listeners.

private const val TAG = "MobyMesh"

/** Bluetooth SIG "reserved for testing" company id (see src/mesh/codec.ts). */
private const val COMPANY_ID = 0xFFFF
private const val MAGIC: Byte = 0x4D
private const val PACKET_BYTES = 24

class MeshException(message: String) : CodedException(message)

// JS asks for the Nearby devices permission before calling anything (src/mesh/radio.ts),
// and every call catches the SecurityException if it was refused anyway.
@SuppressLint("MissingPermission")
class MobyMeshModule : Module() {
  private var scanning = false
  private var advertising = false

  private val context: Context
    get() = appContext.reactContext ?: throw MeshException("React context is gone")

  private val adapter: BluetoothAdapter?
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val data = result.scanRecord?.getManufacturerSpecificData(COMPANY_ID) ?: return
      if (data.size != PACKET_BYTES || data[0] != MAGIC) return
      sendEvent(
        "onPacket",
        mapOf(
          "bytes" to data.map { it.toInt() and 0xFF },
          "rssi" to result.rssi,
          // The sender's address is randomised by Android every ~15 minutes; it's only
          // useful for "how many phones are around me", never to identify anyone.
          "device" to result.device.address,
        ),
      )
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      Log.w(TAG, "scan failed: $errorCode")
      sendEvent("onError", mapOf("where" to "scan", "code" to errorCode))
    }
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      advertising = true
    }

    override fun onStartFailure(errorCode: Int) {
      advertising = false
      Log.w(TAG, "advertise failed: $errorCode")
      sendEvent("onError", mapOf("where" to "advertise", "code" to errorCode))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MobyMesh")
    Events("onPacket", "onError")

    // What this phone can do. Never throws, so the UI can always explain itself.
    Function("getState") {
      val a = adapter
      val supported = a != null && context.packageManager.hasSystemFeature("android.hardware.bluetooth_le")
      mapOf(
        "supported" to supported,
        "enabled" to (a?.isEnabled == true),
        // Some (mostly old or cheap) phones can listen but can't advertise.
        "canAdvertise" to (supported && a?.isMultipleAdvertisementSupported == true),
        "scanning" to scanning,
        "advertising" to advertising,
        "reason" to when {
          a == null -> "no_bluetooth"
          !supported -> "no_ble"
          !a.isEnabled -> "bluetooth_off"
          else -> null
        },
      )
    }

    // Listens until stopScanning(). Android allows only ~5 scan starts per 30 seconds,
    // so JS starts this once and leaves it running, rather than toggling it.
    AsyncFunction("startScanning") { promise: Promise ->
      val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner
        ?: return@AsyncFunction promise.reject(MeshException("Bluetooth is off or missing"))
      if (scanning) return@AsyncFunction promise.resolve(null)
      // Filtering in the Bluetooth chip (not in our code) saves battery and keeps
      // working when the screen is off.
      val filter = ScanFilter.Builder()
        .setManufacturerData(COMPANY_ID, byteArrayOf(MAGIC), byteArrayOf(0xFF.toByte()))
        .build()
      val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
        .build()
      try {
        scanner.startScan(listOf(filter), settings, scanCallback)
        scanning = true
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject(MeshException("Nearby devices permission is missing"))
      }
    }

    Function("stopScanning") {
      if (scanning) {
        try {
          adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (e: SecurityException) {
          Log.w(TAG, "stopScan: ${e.message}")
        }
      }
      scanning = false
    }

    // Replaces whatever we were advertising with this packet.
    AsyncFunction("advertise") { bytes: List<Int>, promise: Promise ->
      if (bytes.size != PACKET_BYTES) {
        return@AsyncFunction promise.reject(MeshException("packet must be $PACKET_BYTES bytes"))
      }
      val advertiser = adapter?.takeIf { it.isEnabled && it.isMultipleAdvertisementSupported }?.bluetoothLeAdvertiser
        ?: return@AsyncFunction promise.reject(MeshException("This phone can't advertise over Bluetooth LE"))
      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(false)
        .setTimeout(0)
        .build()
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false) // the phone's name would identify its owner, and doesn't fit
        .setIncludeTxPowerLevel(false)
        .addManufacturerData(COMPANY_ID, ByteArray(PACKET_BYTES) { bytes[it].toByte() })
        .build()
      try {
        // Always stop first (harmless when idle): a start that hasn't reported back yet
        // would otherwise fail with "already started".
        advertiser.stopAdvertising(advertiseCallback)
        advertising = false
        advertiser.startAdvertising(settings, data, advertiseCallback)
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject(MeshException("Nearby devices permission is missing"))
      }
    }

    Function("stopAdvertising") {
      if (advertising) {
        try {
          adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        } catch (e: SecurityException) {
          Log.w(TAG, "stopAdvertising: ${e.message}")
        }
      }
      advertising = false
    }

    OnDestroy {
      try {
        if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        if (advertising) adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
      } catch (e: SecurityException) {
        Log.w(TAG, "cleanup: ${e.message}")
      }
      scanning = false
      advertising = false
    }
  }
}
