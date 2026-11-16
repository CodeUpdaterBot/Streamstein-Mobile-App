package com.streamstein.app

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Reading the device's video library the way Android intends.
 *
 * The first version walked raw paths under /sdcard, which on Android 11+ needs
 * MANAGE_EXTERNAL_STORAGE — a trip through system settings, and it still cannot see files the
 * media scanner has indexed but that live outside those roots. MediaStore is the index the
 * Photos app itself uses: it needs one runtime permission (a single dialog), returns every
 * video on the device including the ones in app-created folders, and hands back content://
 * URIs the WebView can play directly.
 */
@TauriPlugin
class MediaStorePlugin(private val activity: Activity) : Plugin(activity) {

    /** READ_MEDIA_VIDEO replaced the blanket storage permission in Android 13 (API 33). */
    private fun requiredPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_VIDEO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, requiredPermission()) ==
            PackageManager.PERMISSION_GRANTED

    @Command
    fun access(invoke: Invoke) {
        val out = JSObject()
        out.put("granted", hasPermission())
        out.put("permission", requiredPermission())
        out.put("sdk", Build.VERSION.SDK_INT)
        invoke.resolve(out)
    }

    /**
     * Ask the OS. Resolution is asynchronous and surfaces in the Activity, so the caller polls
     * access() afterwards rather than expecting a result here.
     */
    @Command
    fun requestAccess(invoke: Invoke) {
        val already = hasPermission()
        if (!already) {
            activity.requestPermissions(arrayOf(requiredPermission()), REQUEST_CODE)
        }
        val out = JSObject()
        out.put("alreadyGranted", already)
        out.put("requested", !already)
        invoke.resolve(out)
    }

    @Command
    fun queryVideos(invoke: Invoke) {
        if (!hasPermission()) {
            invoke.reject("MediaStore access not granted")
            return
        }

        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.DURATION,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.DATA,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
        )

        val videos = JSArray()
        try {
            activity.contentResolver
                .query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    MediaStore.Video.Media.DATE_ADDED + " DESC",
                )
                ?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                    val nameCol = cursor.getColumnIndex(MediaStore.Video.Media.DISPLAY_NAME)
                    val durCol = cursor.getColumnIndex(MediaStore.Video.Media.DURATION)
                    val sizeCol = cursor.getColumnIndex(MediaStore.Video.Media.SIZE)
                    val dateCol = cursor.getColumnIndex(MediaStore.Video.Media.DATE_ADDED)
                    val dataCol = cursor.getColumnIndex(MediaStore.Video.Media.DATA)
                    val bucketCol =
                        cursor.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                    while (cursor.moveToNext()) {
                        val id = cursor.getLong(idCol)
                        val entry = JSObject()
                        entry.put("id", id)
                        // The URI the WebView can play without any path access at all.
                        entry.put(
                            "uri",
                            ContentUris.withAppendedId(
                                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                                id,
                            ).toString(),
                        )
                        entry.put("name", if (nameCol >= 0) cursor.getString(nameCol) ?: "" else "")
                        entry.put(
                            "duration_ms",
                            if (durCol >= 0) cursor.getLong(durCol) else 0L,
                        )
                        entry.put("size_bytes", if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L)
                        entry.put(
                            "date_added_s",
                            if (dateCol >= 0) cursor.getLong(dateCol) else 0L,
                        )
                        entry.put("path", if (dataCol >= 0) cursor.getString(dataCol) ?: "" else "")
                        entry.put(
                            "folder",
                            if (bucketCol >= 0) cursor.getString(bucketCol) ?: "" else "",
                        )
                        videos.put(entry)
                    }
                }
        } catch (e: Exception) {
            invoke.reject("MediaStore query failed: " + (e.message ?: "unknown"))
            return
        }

        val out = JSObject()
        out.put("videos", videos)
        invoke.resolve(out)
    }

    companion object {
        const val REQUEST_CODE: Int = 0x5354
    }

    /**
     * Hand a video to whatever player the phone already has.
     *
     * The in-app WebView player only manages codecs the WebView supports, while the system
     * player (Samsung Video, Photos, VLC) plays whatever the device can decode. So anything the
     * WebView refuses opens here instead — no video on the device is unreachable.
     */
    @Command
    fun openInSystemPlayer(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        try {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
            intent.setDataAndType(android.net.Uri.parse(args.uri), "video/*")
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            invoke.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            invoke.reject("No app on this device could open that video: " + (e.message ?: "unknown"))
        }
    }
}

@app.tauri.annotation.InvokeArg
class OpenArgs {
    lateinit var uri: String
}
