// =============================================================================
// dlopen_test.cpp – Android on-device dynamic load test
// =============================================================================
// Standalone NDK executable that:
//   1. Opens libgodot.so via dlopen()
//   2. Resolves each required JNI symbol via dlsym()
//   3. Verifies function pointers are non-null (no SIGSEGV)
//   4. Exits 0 on all-pass, 1 on any failure
//
// Build: cmake + NDK toolchain (see CMakeLists.txt)
// Run on device:
//   adb push dlopen_test /data/local/tmp/
//   adb push libgodot.so /data/local/tmp/
//   adb shell chmod +x /data/local/tmp/dlopen_test
//   adb shell /data/local/tmp/dlopen_test /data/local/tmp/libgodot.so
// =============================================================================

#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <setjmp.h>
#include <sys/types.h>
#include <jni.h>   // Pulled from NDK sysroot for JNIEnv typedef

// ── SIGSEGV guard ────────────────────────────────────────────────────────────
// We wrap each dlsym + call-site in a signal handler to catch segfaults from
// bad function pointers rather than crashing the whole test runner.

static sigjmp_buf g_jmp;
static volatile sig_atomic_t g_in_probe = 0;

static void segv_handler(int sig) {
    if (g_in_probe) {
        siglongjmp(g_jmp, 1);
    }
    // Not in a probe — let the default handler crash us
    signal(SIGSEGV, SIG_DFL);
    raise(SIGSEGV);
}

// ── Colour helpers ────────────────────────────────────────────────────────────

static const char* RED    = "\033[0;31m";
static const char* GREEN  = "\033[0;32m";
static const char* YELLOW = "\033[1;33m";
static const char* CYAN   = "\033[0;36m";
static const char* BOLD   = "\033[1m";
static const char* NC     = "\033[0m";

// ── Symbol list ───────────────────────────────────────────────────────────────
// Each entry: (symbol_name, required=1/advisory=0)
struct SymbolEntry {
    const char* name;
    int         required;   // 0 = advisory warning only
};

static const SymbolEntry SYMBOLS[] = {
    // Core Godot embedding C-API (master / 4.6+)
    { "libgodot_create_godot_instance",                          1 },

    // Core lifecycle JNI (hard-required)
    { "Java_org_godotengine_godot_GodotLib_initialize",          1 },
    { "Java_org_godotengine_godot_GodotLib_setup",               1 },
    { "Java_org_godotengine_godot_GodotLib_step",                1 },
    { "Java_org_godotengine_godot_GodotLib_ondestroy",           1 },
    { "Java_org_godotengine_godot_GodotLib_newcontext",          1 },
    { "Java_org_godotengine_godot_GodotLib_resize",              1 },
    { "Java_org_godotengine_godot_GodotLib_back",                1 },

    // Input (hard-required)
    { "Java_org_godotengine_godot_GodotLib_key",                 1 },
    { "Java_org_godotengine_godot_GodotLib_dispatchTouchEvent",  1 },
    { "Java_org_godotengine_godot_GodotLib_accelerometer",       1 },

    // Plugin/Callable bridge
    { "Java_org_godotengine_godot_plugin_GodotPlugin_nativeRegisterSingleton", 1 },
    { "Java_org_godotengine_godot_variant_Callable_nativeCall",  1 },

    // Renderer info
    { "Java_org_godotengine_godot_GodotLib_getRendererInfo",     1 },

    // Project resource path (needed for PCK loading)
    { "Java_org_godotengine_godot_GodotLib_getProjectResourceDir", 1 },
};

static const size_t SYMBOL_COUNT = sizeof(SYMBOLS) / sizeof(SYMBOLS[0]);

// ── Test runner ───────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    printf("\n%s%s▶ Android dlopen / dlsym Test%s\n", BOLD, CYAN, NC);

    if (argc < 2) {
        fprintf(stderr, "%s✗ Usage: %s <path-to-libgodot.so>%s\n",
                RED, argv[0], NC);
        return 1;
    }

    const char* so_path = argv[1];
    if (access(so_path, F_OK) != 0) {
        fprintf(stderr, "%s✗ File not found: %s%s\n", RED, so_path, NC);
        return 1;
    }
    printf("  Library : %s\n", so_path);

    // Set up SIGSEGV guard
    signal(SIGSEGV, segv_handler);

    // ── Step 1: dlopen ────────────────────────────────────────────────────────
    printf("\n%s%s▶ 1. dlopen%s\n", BOLD, CYAN, NC);
    dlerror();  // clear previous errors

    g_in_probe = 1;
    void* handle = NULL;
    if (sigsetjmp(g_jmp, 1) == 0) {
        handle = dlopen(so_path, RTLD_LAZY | RTLD_LOCAL);
    } else {
        fprintf(stderr, "%s✗ SIGSEGV during dlopen(%s)%s\n",
                RED, so_path, NC);
        return 1;
    }
    g_in_probe = 0;

    if (!handle) {
        fprintf(stderr, "%s✗ dlopen failed: %s%s\n", RED, dlerror(), NC);
        return 1;
    }
    printf("  %s✓%s dlopen succeeded (handle = %p)\n", GREEN, NC, handle);

    // ── Step 2: dlsym each symbol ─────────────────────────────────────────────
    printf("\n%s%s▶ 2. dlsym symbol resolution%s\n", BOLD, CYAN, NC);

    int pass = 0, fail = 0, skip = 0;

    for (size_t i = 0; i < SYMBOL_COUNT; i++) {
        const char* sym  = SYMBOLS[i].name;
        int required     = SYMBOLS[i].required;

        dlerror();
        void* fn = NULL;

        g_in_probe = 1;
        int sigsegv_caught = 0;
        if (sigsetjmp(g_jmp, 1) == 0) {
            fn = dlsym(handle, sym);
        } else {
            sigsegv_caught = 1;
        }
        g_in_probe = 0;

        if (sigsegv_caught) {
            if (required) {
                printf("  %s✗%s [CRASH]   %s — SIGSEGV during dlsym!\n",
                       RED, NC, sym);
                fail++;
            } else {
                printf("  %s⚠%s [CRASH]   %s — SIGSEGV (advisory)\n",
                       YELLOW, NC, sym);
                skip++;
            }
            continue;
        }

        const char* err = dlerror();
        if (fn && !err) {
            printf("  %s✓%s %-60s  @ %p\n", GREEN, NC, sym, fn);
            pass++;
        } else if (!required) {
            printf("  %s⚠%s [MISSING] %s (advisory — expected in 4.5+)\n",
                   YELLOW, NC, sym);
            skip++;
        } else {
            printf("  %s✗%s [MISSING] %s\n", RED, NC, sym);
            if (err) printf("             dlerror: %s\n", err);
            fail++;
        }
    }

    // ── Step 3: dlclose ───────────────────────────────────────────────────────
    printf("\n%s%s▶ 3. dlclose%s\n", BOLD, CYAN, NC);

    g_in_probe = 1;
    int close_status = 0;
    if (sigsetjmp(g_jmp, 1) == 0) {
        close_status = dlclose(handle);
    } else {
        printf("  %s✗%s SIGSEGV during dlclose\n", RED, NC);
        fail++;
        goto summary;
    }
    g_in_probe = 0;

    if (close_status == 0) {
        printf("  %s✓%s dlclose() returned 0 ✓\n", GREEN, NC);
    } else {
        printf("  %s⚠%s dlclose() returned %d: %s\n",
               YELLOW, NC, close_status, dlerror());
    }

summary:
    printf("\n============================================================\n");
    printf("  Test 03: Android dlopen/dlsym\n");
    printf("  Passed : %-4d | Failed : %-4d | Advisory : %d\n",
           pass, fail, skip);
    printf("============================================================\n\n");

    return (fail == 0) ? 0 : 1;
}
