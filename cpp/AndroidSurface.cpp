#ifdef __ANDROID__
///
/// AndroidSurface.cpp
/// JNI helper that extracts an ANativeWindow* from a Java android.view.Surface
/// and returns it as a 64-bit integer for zero-copy handoff to the Nitro layer.
///
/// Called from GodotSurfaceView.kt via:
///   GodotSurfaceView.nativeGetSurfacePointer(surface: Surface): Long
///

#include <jni.h>
#include <android/native_window_jni.h>
#include <android/log.h>

#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "NitroGodot", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "NitroGodot", __VA_ARGS__)

extern "C" {

/**
 * JNI signature matches GodotSurfaceView companion object declaration:
 *   external fun nativeGetSurfacePointer(surface: Surface): Long
 *
 * Returns the ANativeWindow* cast to jlong (int64_t).
 * The caller must NOT release or close this window — the SurfaceView's
 * SurfaceHolder owns the lifetime. The pointer is valid until surfaceDestroyed().
 */
JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_godot_GodotSurfaceView_nativeGetSurfacePointer(
    JNIEnv* env,
    jclass  /* clazz */,
    jobject surface)
{
  ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) {
    LOGE("ANativeWindow_fromSurface returned null");
    return 0;
  }

  // Release the extra reference acquired by ANativeWindow_fromSurface.
  // The Surface's own reference keeps the window alive while the surface exists.
  ANativeWindow_release(window);

  LOGD("nativeGetSurfacePointer → 0x%llx", (unsigned long long)(uintptr_t)window);

  return static_cast<jlong>(reinterpret_cast<uintptr_t>(window));
}

} // extern "C"
#endif // __ANDROID__
