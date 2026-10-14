package expo.modules.mobymesh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// Keeps Moby's process alive while the Bluetooth mesh is on, so phones keep passing
// alerts while Moby is in the background. It does no work itself: the scan and the
// broadcast rotation live in MobyMeshModule; this only tells Android "the user wants
// this running" (and Android requires the visible notification for that).
//
// Type `connectedDevice`: the Play Console asks for a short justification of it.
// See docs/mesh-guide.md, "Background".

private const val CHANNEL_ID = "moby_mesh"
private const val NOTIFICATION_ID = 7301

class MeshForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // If Android kills us for memory, don't restart without the app: the radio state
    // lives in the app's module, and JS restarts the mesh when Moby next opens.
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    // Android 15+ may time out some service types; stop cleanly rather than crash.
    stopSelf()
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Nearby phones (Bluetooth)", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Moby passes alerts to and from nearby phones"
          setShowBadge(false)
        },
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentTitle("Sharing alerts with nearby phones")
      .setContentText("Moby passes warnings over Bluetooth, even with no signal. Turn off in Settings.")
      .setOngoing(true)
      .setContentIntent(open)
      .build()
  }
}
