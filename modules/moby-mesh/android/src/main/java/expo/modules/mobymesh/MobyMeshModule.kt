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
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Moby's Bluetooth mesh radio, Android side. Deliberately small: it only
//   - rotates through the 24-byte packets JS gives it, advertising each for a moment,
//   - listens for other phones' packets and hands the raw bytes to JS, and
//   - keeps Moby running in the background with a foreground service (MeshForegroundService).
// The rotation is here, not in JS, because Android pauses JS timers in the background.
// Everything else (format, duplicates, hop limits, uploads) is plain TypeScript in
// src/mesh/, where it's unit-tested. See docs/mesh-guide.md.
//
// Packets ride in the manufacturer-specific data of a non-connectable advertisement:
// no pairing, no connection, any number of listeners.
//
// Bluetooth can be switched off and on (by the user, or by Android restarting its
// Bluetooth stack), which silently ends our scan and advertisement. So we remember what
// JS asked for (`wantScan`, `queue`) and resume it when Bluetooth comes back on.

private const val TAG = "MobyMesh"

/** Bluetooth SIG "reserved for testing" company id (see src/mesh/codec.ts). */
private const val COMPANY_ID = 0xFFFF
private const val MAGIC: Byte = 0x4D
private const val PACKET_BYTES = 24

class MeshException(message: String) : CodedException(message)

// JS asks for the Nearby devices permission before calling anything
// (src/mesh/meshService.ts), and every call catches the SecurityException anyway.
@SuppressLint("MissingPermission")
class MobyMeshModule : Module() {
  private var scanning = false
  private var advertising = false
  private var wantScan = false
  private var receiverRegistered = false

  // Broadcast rotation: each packet is on the air for `intervalMs`, then the next.
  private val handler = Handler(Looper.getMainLooper())
  private var queue: List<ByteArray> = emptyList()
  private var queueIndex = 0
  private var intervalMs = 1_500L
  private val rotate = object : Runnable {
    override fun run() {
      if (queue.isEmpty()) return
      startAdvertising(queue[queueIndex % queue.size])
      queueIndex += 1
      handler.postDelayed(this, intervalMs)
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw MeshException("React context is gone")

  private val adapter: BluetoothAdapter?
    get() = (appContext.reactContext?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

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

  private val bluetoothStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> {
          // The stack has dropped our scan and advertisement; don't call stop on them.
          handler.removeCallbacks(rotate)
          scanning = false
          advertising = false
          sendEvent("onStateChange", mapOf("enabled" to false))
        }
        BluetoothAdapter.STATE_ON -> {
          Log.i(TAG, "Bluetooth back on: resuming (scan=$wantScan, packets=${queue.size})")
          if (wantScan) startScan()
          handler.removeCallbacks(rotate)
          if (queue.isNotEmpty()) handler.post(rotate)
          sendEvent("onStateChange", mapOf("enabled" to true))
        }
      }
    }
  }

  /** Starts listening. Returns null on success, or why it couldn't. */
  private fun startScan(): String? {
    val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner ?: return "Bluetooth is off or missing"
    if (scanning) return null
    // Filtering in the Bluetooth chip (not in our code) saves battery and keeps working
    // when the screen is off. Chips without filter support fall back to software.
    val filter = ScanFilter.Builder()
      .setManufacturerData(COMPANY_ID, byteArrayOf(MAGIC), byteArrayOf(0xFF.toByte()))
      .build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .build()
    return try {
      scanner.startScan(listOf(filter), settings, scanCallback)
      scanning = true
      null
    } catch (e: SecurityException) {
      "Nearby devices permission is missing"
    }
  }

  /** Replaces whatever we were advertising. Returns null on success, or why it couldn't. */
  private fun startAdvertising(packet: ByteArray): String? {
    val advertiser = adapter?.takeIf { it.isEnabled && it.isMultipleAdvertisementSupported }?.bluetoothLeAdvertiser
      ?: return "This phone can't advertise over Bluetooth LE"
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(false)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false) // the phone's name would identify its owner, and doesn't fit
      .setIncludeTxPowerLevel(false)
      .addManufacturerData(COMPANY_ID, packet)
      .build()
    return try {
      // Always stop first (harmless when idle): a start that hasn't reported back yet
      // would otherwise fail with "already started".
      advertiser.stopAdvertising(advertiseCallback)
      advertising = false
      advertiser.startAdvertising(settings, data, advertiseCallback)
      null
    } catch (e: SecurityException) {
      "Nearby devices permission is missing"
    }
  }

  private fun stopAdvertisingNow() {
    try {
      if (advertising) adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    } catch (e: SecurityException) {
      Log.w(TAG, "stopAdvertising: ${e.message}")
    } catch (e: IllegalStateException) {
      Log.w(TAG, "stopAdvertising: ${e.message}")
    }
    advertising = false
  }

  private fun stopAll() {
    handler.removeCallbacks(rotate)
    try {
      if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
      if (advertising) adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    } catch (e: SecurityException) {
      Log.w(TAG, "stop: ${e.message}")
    } catch (e: IllegalStateException) {
      Log.w(TAG, "stop: ${e.message}") // Bluetooth already off
    }
    scanning = false
    advertising = false
  }

  override fun definition() = ModuleDefinition {
    Name("MobyMesh")
    Events("onPacket", "onError", "onStateChange")

    OnCreate {
      appContext.reactContext?.let {
        it.registerReceiver(bluetoothStateReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
        receiverRegistered = true
      }
    }

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

    // Listens until stopScanning(), and resumes by itself after Bluetooth comes back on.
    // Android allows only ~5 scan starts per 30 seconds, so JS starts this once.
    AsyncFunction("startScanning") { promise: Promise ->
      wantScan = true
      val problem = startScan()
      if (problem == null) promise.resolve(null) else promise.reject(MeshException(problem))
    }

    Function("stopScanning") {
      wantScan = false
      try {
        if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
      } catch (e: SecurityException) {
        Log.w(TAG, "stopScan: ${e.message}")
      } catch (e: IllegalStateException) {
        Log.w(TAG, "stopScan: ${e.message}")
      }
      scanning = false
    }

    // The packets to keep broadcasting, in order (replaces the previous set). An empty
    // list stops advertising. Each packet is on the air for intervalMs.
    Function("setBroadcast") { packets: List<List<Int>>, interval: Int ->
      val next = packets.filter { it.size == PACKET_BYTES }.map { p -> ByteArray(PACKET_BYTES) { p[it].toByte() } }
      intervalMs = interval.coerceIn(500, 10_000).toLong()
      val unchanged = next.size == queue.size && next.zip(queue).all { (a, b) -> a.contentEquals(b) }
      if (unchanged) return@Function
      queue = next
      queueIndex = 0
      handler.removeCallbacks(rotate)
      if (queue.isEmpty()) stopAdvertisingNow() else handler.post(rotate)
    }

    // Keeps Moby alive in the background (Android shows a notification while it does).
    // Must be called while the app is in the foreground: Android 12+ refuses to start a
    // foreground service from the background.
    Function("setKeepRunning") { on: Boolean ->
      val ctx = appContext.reactContext ?: return@Function false
      val intent = Intent(ctx, MeshForegroundService::class.java)
      try {
        if (on) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
        } else {
          ctx.stopService(intent)
        }
        true
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (app in background) or a missing permission:
        // the mesh still works while Moby is open.
        Log.w(TAG, "keep running ($on): ${e.message}")
        false
      }
    }

    OnDestroy {
      wantScan = false
      queue = emptyList()
      stopAll()
      if (receiverRegistered) {
        try {
          appContext.reactContext?.unregisterReceiver(bluetoothStateReceiver)
        } catch (e: IllegalArgumentException) {
          Log.w(TAG, "unregister: ${e.message}")
        }
        receiverRegistered = false
      }
    }
  }
}
