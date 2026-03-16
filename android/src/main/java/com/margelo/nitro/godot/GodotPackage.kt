package com.margelo.nitro.godot

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * GodotPackage — React Native package registration for react-native-nitro-godot.
 *
 * Add to your application's ReactNativeHost:
 * ```kotlin
 * override fun getPackages() = listOf(GodotPackage(), ...)
 * ```
 *
 * On first instantiation, this triggers System.loadLibrary("NitroGodot") via
 * NitroGodotOnLoad.initializeNative(), which fires JNI_OnLoad → registerAllNatives()
 * → HybridObjectRegistry::registerHybridObjectConstructor("GodotEngine").
 */
class GodotPackage : ReactPackage {

  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> {
    // Bootstrap the Nitro C++ library. Idempotent — safe to call multiple times.
    NitroGodotOnLoad.initializeNative()
    return emptyList()
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> {
    return listOf(GodotViewManager())
  }
}
