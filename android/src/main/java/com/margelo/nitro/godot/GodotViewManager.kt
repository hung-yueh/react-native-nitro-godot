package com.margelo.nitro.godot

import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.common.MapBuilder

/**
 * GodotViewManager — React Native ViewManager for the native Godot surface.
 *
 * JS usage (via requireNativeComponent or the GodotView wrapper):
 *   <GodotView onSurfaceCreated={e => engine.attachSurface(BigInt(e.nativeEvent.pointer))} />
 */
class GodotViewManager : SimpleViewManager<GodotSurfaceView>() {

  override fun getName() = "GodotView"

  override fun createViewInstance(context: ThemedReactContext): GodotSurfaceView {
    return GodotSurfaceView(context)
  }

  // ── Event registration ─────────────────────────────────────────────────
  // Bubbling events flow up the view hierarchy; direct events do not.
  // We use direct events so only the GodotView's JS handler fires.

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
    return MapBuilder.builder<String, Any>()
      .put("onSurfaceCreated",  MapBuilder.of("registrationName", "onSurfaceCreated"))
      .put("onSurfaceChanged",  MapBuilder.of("registrationName", "onSurfaceChanged"))
      .put("onSurfaceDestroyed",MapBuilder.of("registrationName", "onSurfaceDestroyed"))
      .put("onTouchEvent",      MapBuilder.of("registrationName", "onTouchEvent"))
      .build()
  }
}
