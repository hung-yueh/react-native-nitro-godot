package com.margelo.nitro.godot

import android.content.Context
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * GodotSurfaceView — SurfaceView that bridges ANativeWindow* → Nitro attachSurface().
 *
 * Surface lifetime flow:
 *   1. Android creates the SurfaceHolder's Surface (surfaceCreated)
 *   2. We call nativeGetSurfacePointer(surface) → returns ANativeWindow* as Long
 *   3. We emit onSurfaceCreated({ pointer: "<hex>" }) up to JS
 *   4. JS engine.attachSurface(BigInt(pointer)) stores pointer in pending_surface_
 *   5. Separately, we call GodotLib.newcontext to set the surface in os_android
 *      (this must run AFTER GodotLib.initialize has built the os_android singleton)
 *   6. On surfaceDestroyed, emit onSurfaceDestroyed so JS can call engine.pause()
 *
 * GodotLib JNI bridge:
 *   libgodot.so exports Java_org_godotengine_godot_GodotLib_newcontext — the same
 *   function that the normal Godot Android runner calls internally. We route our
 *   surface through this symbol to set os_android->set_native_window(ANativeWindow*).
 */
class GodotSurfaceView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

  init {
    holder.addCallback(this)
  }

  // ── SurfaceHolder.Callback ─────────────────────────────────────────────

  override fun surfaceCreated(holder: SurfaceHolder) {
    val ptr = nativeGetSurfacePointer(holder.surface)
    emitEvent("onSurfaceCreated", Arguments.createMap().apply {
      // Pass as unsigned decimal string — JS reads BigInt("12345...") → UInt64 for Nitro.
      // Using toULong() avoids negative hex from signed Long.toString(16).
      putString("pointer", ptr.toULong().toString())
    })
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    emitEvent("onSurfaceChanged", Arguments.createMap().apply {
      putInt("width", width)
      putInt("height", height)
    })
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    emitEvent("onSurfaceDestroyed", Arguments.createMap())
  }

  // ── Event dispatch ─────────────────────────────────────────────────────

  private fun emitEvent(eventName: String, params: WritableMap) {
    val reactContext = context as? ReactContext ?: return
    reactContext
      .getJSModule(RCTEventEmitter::class.java)
      .receiveEvent(id, eventName, params)
  }

  // ── Touch event forwarding ────────────────────────────────────────────

  private var lastTouchX = FloatArray(10) { 0f }
  private var lastTouchY = FloatArray(10) { 0f }

  override fun onTouchEvent(event: android.view.MotionEvent): Boolean {
    val pointerIndex = event.actionIndex
    val pointerId = event.getPointerId(pointerIndex).coerceAtMost(9)
    val x = event.getX(pointerIndex)
    val y = event.getY(pointerIndex)

    val action = when (event.actionMasked) {
      android.view.MotionEvent.ACTION_DOWN,
      android.view.MotionEvent.ACTION_POINTER_DOWN -> "down"
      android.view.MotionEvent.ACTION_MOVE -> "move"
      android.view.MotionEvent.ACTION_UP,
      android.view.MotionEvent.ACTION_POINTER_UP,
      android.view.MotionEvent.ACTION_CANCEL -> "up"
      else -> return super.onTouchEvent(event)
    }

    val deltaX = x - lastTouchX[pointerId]
    val deltaY = y - lastTouchY[pointerId]
    lastTouchX[pointerId] = x
    lastTouchY[pointerId] = y

    if (action == "down") {
      lastTouchX[pointerId] = x
      lastTouchY[pointerId] = y
    }

    // For move events, we may get multiple pointers in one event
    if (action == "move") {
      for (i in 0 until event.pointerCount) {
        val pid = event.getPointerId(i).coerceAtMost(9)
        val px = event.getX(i)
        val py = event.getY(i)
        val dx = px - lastTouchX[pid]
        val dy = py - lastTouchY[pid]
        lastTouchX[pid] = px
        lastTouchY[pid] = py

        emitEvent("onTouchEvent", Arguments.createMap().apply {
          putString("action", "move")
          putInt("pointerId", pid)
          putDouble("x", px.toDouble())
          putDouble("y", py.toDouble())
          putDouble("deltaX", dx.toDouble())
          putDouble("deltaY", dy.toDouble())
        })
      }
    } else {
      emitEvent("onTouchEvent", Arguments.createMap().apply {
        putString("action", action)
        putInt("pointerId", pointerId)
        putDouble("x", x.toDouble())
        putDouble("y", y.toDouble())
        putDouble("deltaX", 0.0)
        putDouble("deltaY", 0.0)
      })
    }

    return true
  }

  // ── Native JNI bridge ──────────────────────────────────────────────────

  companion object {
    /**
     * JNI function implemented in cpp/AndroidSurface.cpp.
     * Calls ANativeWindow_fromSurface(env, surface) and returns the pointer
     * cast to a 64-bit Long. Returns 0 on failure.
     *
     * This value is passed to JS as a hex string and consumed by
     * engine.attachSurface(BigInt("0x...")) via the useGodotEngine hook.
     */
    @JvmStatic
    external fun nativeGetSurfacePointer(surface: Surface): Long
  }
}
