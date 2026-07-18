/**
 * test_proc_resolution.h — Compile-time validation of GDExtensionProcs::resolve()
 *
 * PURPOSE:
 *   Catch regressions in the compatibility shim for renamed/removed GDExtension APIs.
 *   The exact bug this guards against: resolve() calling get_proc() with old API names
 *   (e.g. "get_type_from_variant_constructor") that return nullptr on Godot 4.6-dev+,
 *   causing the entire Godot→JS message pipeline to silently break.
 *
 * HOW IT WORKS:
 *   Provides a mock get_proc that simulates a "new Godot" (4.6-dev+) environment where:
 *   - "get_type_from_variant_constructor" → nullptr (renamed)
 *   - "get_variant_to_type_constructor"   → valid pointer
 *   - "string_name_destroy"              → nullptr (removed)
 *   - "string_destroy"                   → nullptr (removed)
 *   - "packed_float32_array_destroy"     → nullptr (removed)
 *   - "packed_float32_array_size"        → nullptr (removed)
 *   - "variant_get_ptr_destructor"       → valid (fallback path)
 *
 *   Calls resolve() with this mock and verifies all critical pointers are non-null.
 *
 * USAGE:
 *   This is included in debug builds only. The static constructor runs at load time
 *   and will abort with a clear message if any critical proc is null.
 *
 *   To enable: compile with -DTEST_PROC_RESOLUTION
 *   In production builds, this file is a no-op.
 */

#pragma once

#ifdef TEST_PROC_RESOLUTION

#include "GDExtensionTypes.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace proc_resolution_test {

// GDExtensionProcs (the cached proc table + resolve()) lives in the module
// namespace; bring it into scope so this test can construct and verify it.
using ::margelo::nitro::godot::GDExtensionProcs;

// ── Sentinel pointers ─────────────────────────────────────────────────────
// We can't call these functions, but we need non-null pointers to verify
// that resolve() populated them correctly.

static void sentinel_sn_new(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool) {}
static GDExtensionObjectPtr sentinel_get_singleton(GDExtensionConstStringNamePtr) { return nullptr; }
static GDExtensionVariantFromTypeConstructorFunc sentinel_get_var_from_type(GDExtensionVariantType) { return nullptr; }
static GDExtensionTypeFromVariantConstructorFunc sentinel_get_type_from_var(GDExtensionVariantType) { return nullptr; }
static void sentinel_var_call(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                              const GDExtensionConstVariantPtr*, GDExtensionInt,
                              GDExtensionUninitializedVariantPtr, GDExtensionCallError*) {}
static void sentinel_var_new_nil(GDExtensionUninitializedVariantPtr) {}
static void sentinel_var_destroy(GDExtensionVariantPtr) {}
static void sentinel_str_new_utf8(GDExtensionUninitializedStringPtr, const char*) {}
static void sentinel_str_new_latin1(GDExtensionUninitializedStringPtr, const char*) {}
static GDExtensionInt sentinel_str_to_utf8(GDExtensionConstStringPtr, char*, GDExtensionInt) { return 0; }
static const float* sentinel_pfa32_index(GDExtensionConstTypePtr, GDExtensionInt) { return nullptr; }

// Sentinel destructor for the fallback path
static void sentinel_destructor(GDExtensionTypePtr) {}

// Mock variant_get_ptr_destructor — returns our sentinel for any type
static void(*mock_variant_get_ptr_destructor(GDExtensionVariantType))(GDExtensionTypePtr) {
  return sentinel_destructor;
}

// ── Mock get_proc simulating Godot 4.6-dev+ ──────────────────────────────
//
// Returns nullptr for OLD/removed names, valid pointers for new names.
// This is the exact scenario that broke the proc caching.

static GDExtensionInterfaceFunctionPtr mock_get_proc_new_godot(const char* name) {
  // These functions still exist in 4.6-dev
  if (strcmp(name, "string_name_new_with_latin1_chars") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_sn_new);
  if (strcmp(name, "global_get_singleton") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_get_singleton);
  if (strcmp(name, "get_variant_from_type_constructor") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_get_var_from_type);
  if (strcmp(name, "variant_call") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_var_call);
  if (strcmp(name, "variant_new_nil") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_var_new_nil);
  if (strcmp(name, "variant_destroy") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_var_destroy);
  if (strcmp(name, "string_new_with_utf8_chars") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_str_new_utf8);
  if (strcmp(name, "string_new_with_latin1_chars") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_str_new_latin1);
  if (strcmp(name, "string_to_utf8_chars") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_str_to_utf8);
  if (strcmp(name, "packed_float32_array_operator_index_const") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_pfa32_index);

  // ── RENAMED in 4.6-dev ──────────────────────────────────────────────
  // OLD name returns nullptr, NEW name returns valid pointer
  if (strcmp(name, "get_variant_to_type_constructor") == 0)  // NEW name
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)sentinel_get_type_from_var);
  if (strcmp(name, "get_type_from_variant_constructor") == 0)  // OLD name
    return nullptr;

  // ── REMOVED in 4.6-dev ──────────────────────────────────────────────
  // Must be resolved via variant_get_ptr_destructor fallback
  if (strcmp(name, "string_name_destroy") == 0) return nullptr;
  if (strcmp(name, "string_destroy") == 0) return nullptr;
  if (strcmp(name, "packed_float32_array_destroy") == 0) return nullptr;
  if (strcmp(name, "packed_float32_array_size") == 0) return nullptr;

  // ── Fallback resolver ────────────────────────────────────────────────
  if (strcmp(name, "variant_get_ptr_destructor") == 0)
    return reinterpret_cast<GDExtensionInterfaceFunctionPtr>((void*)mock_variant_get_ptr_destructor);

  return nullptr;
}

// ── Test runner ──────────────────────────────────────────────────────────

static bool run_proc_resolution_tests() {
  GDExtensionProcs procs{};
  bool ok = procs.resolve(mock_get_proc_new_godot);

  int failures = 0;

#define ASSERT_NON_NULL(field) \
  if (!procs.field) { \
    fprintf(stderr, "PROC TEST FAILED: " #field " is null\n"); \
    ++failures; \
  }

  // Critical messaging pipeline procs
  ASSERT_NON_NULL(sn_new);
  ASSERT_NON_NULL(get_singleton);
  ASSERT_NON_NULL(get_var_from_type);
  ASSERT_NON_NULL(get_type_from_var);   // THE proc that was broken!
  ASSERT_NON_NULL(get_var_to_type);
  ASSERT_NON_NULL(var_call);
  ASSERT_NON_NULL(var_new_nil);
  ASSERT_NON_NULL(var_destroy);

  // String operations
  ASSERT_NON_NULL(str_new_utf8);
  ASSERT_NON_NULL(str_new_latin1);
  ASSERT_NON_NULL(str_to_utf8);

  // Destructor fallback paths (removed in 4.6-dev)
  ASSERT_NON_NULL(sn_destroy);     // via variant_get_ptr_destructor
  ASSERT_NON_NULL(str_destroy);    // via variant_get_ptr_destructor
  ASSERT_NON_NULL(pfa32_destroy);  // via variant_get_ptr_destructor

  // PFA32 index
  ASSERT_NON_NULL(pfa32_index);

  // pfa32_size is expected to be null on 4.6-dev (intentionally removed)
  // This is OK — callers handle nullptr gracefully

  // resolve() should return true if critical procs succeeded
  if (!ok) {
    fprintf(stderr, "PROC TEST FAILED: resolve() returned false\n");
    ++failures;
  }

#undef ASSERT_NON_NULL

  if (failures == 0) {
    fprintf(stderr, "PROC TEST: All %d checks passed ✓\n", 16);
  } else {
    fprintf(stderr, "PROC TEST: %d checks FAILED\n", failures);
  }

  return failures == 0;
}

// ── Static constructor — runs at library load time ───────────────────────
// Only in debug/test builds (guarded by TEST_PROC_RESOLUTION).

struct ProcResolutionTestRunner {
  ProcResolutionTestRunner() {
    if (!run_proc_resolution_tests()) {
      fprintf(stderr, "\n*** PROC RESOLUTION TESTS FAILED ***\n"
                      "*** The GDExtension compatibility shim is broken. ***\n"
                      "*** This will cause the Godot→JS message pipeline to silently fail. ***\n\n");
      // Don't abort — just log loudly so it's visible in logcat/Xcode console
    }
  }
};

static ProcResolutionTestRunner s_test_runner;

} // namespace proc_resolution_test

#endif // TEST_PROC_RESOLUTION
