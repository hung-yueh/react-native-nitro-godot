#include <jni.h>
#include <dlfcn.h>
#include <string>
#include <android/log.h>
#include <android/native_window_jni.h>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "GodotSandbox", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "GodotSandbox", __VA_ARGS__)

typedef void* GDExtensionObjectPtr;
typedef void (*GDExtensionInitializationFunction)(void*, void*);

GDExtensionObjectPtr (*libgodot_create_instance)(int, char**, GDExtensionInitializationFunction) = nullptr;
bool godot_ready = false;

extern "C" JNIEXPORT void JNICALL
Java_com_example_godotsandbox_MainActivity_initGodot(JNIEnv *env, jobject thiz, jobject surface) {
    if (godot_ready) return;

    void* handle = dlopen("libgodot.so", RTLD_NOW | RTLD_GLOBAL);
    if (!handle) {
        LOGE("Failed to load libgodot.so! %s", dlerror());
        return;
    }

    libgodot_create_instance = (GDExtensionObjectPtr (*)(int, char**, GDExtensionInitializationFunction))
            dlsym(handle, "libgodot_create_godot_instance");

    if (!libgodot_create_instance) {
        LOGE("Failed to find libgodot_create_godot_instance! %s", dlerror());
        return;
    }

    LOGI("Successfully found C-API! Initializing Godot Engine...");

    char* args[] = { (char*)"--headless" };
    // Pass args and null as the initialize function since we just want a simple boot-up test
    void* result = libgodot_create_instance(1, args, nullptr);

    if (result) {
        LOGI("Godot Engine instantiated via C-API!");
        godot_ready = true;
    } else {
        LOGE("libgodot_create_godot_instance returned NULL!");
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_example_godotsandbox_MainActivity_stepGodot(JNIEnv *env, jobject thiz) {
    // This represents where `step` would normally be repeatedly pushed to the engine frame pump.
    if (godot_ready) {
        // Just printing occasional logs to prevent log spam, verifying thread is alive
        static int count = 0;
        if (count++ % 100 == 0) {
             LOGI("Godot engine pumping frame %d", count);
        }
    }
}
