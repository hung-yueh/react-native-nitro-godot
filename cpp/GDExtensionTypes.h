///
/// GDExtensionTypes.h — Shared GDExtension function pointer typedefs
///
/// These type aliases are used throughout HybridGodotEngine.cpp for
/// GDExtension variant_call pipelines. Defined once here to avoid
/// duplicating the same ~12 using-declarations in every method.
///

#pragma once

#include "libgodot.h"

namespace margelo::nitro::godot {

// ── GDExtension Function Pointer Types ──────────────────────────────────────

/// StringName construction from Latin-1 C-string
using FnSNNewLatin1 = void(*)(GDExtensionUninitializedStringNamePtr, const char*, GDExtensionBool);

/// StringName/Variant destructor
using FnSNDestroy = void(*)(GDExtensionVariantPtr);

/// Retrieve a global singleton by StringName
using FnGetSingleton = GDExtensionObjectPtr(*)(GDExtensionConstStringNamePtr);

/// Get a Variant-from-type constructor for a given type
using FnGetVarFromType = GDExtensionVariantFromTypeConstructorFunc(*)(GDExtensionVariantType);

/// Get a type-from-Variant constructor for a given type
using FnGetTypeFromVar = GDExtensionTypeFromVariantConstructorFunc(*)(GDExtensionVariantType);

/// Call a method on a Variant via StringName
using FnVariantCall = void(*)(GDExtensionVariantPtr, GDExtensionConstStringNamePtr,
                               const GDExtensionConstVariantPtr*, GDExtensionInt,
                               GDExtensionUninitializedVariantPtr, GDExtensionCallError*);

/// Construct a nil Variant
using FnVariantNew = void(*)(GDExtensionUninitializedVariantPtr);

/// Destroy a Variant
using FnVariantDestroy = void(*)(GDExtensionVariantPtr);

/// Construct a Godot String from UTF-8 C-string
using FnStringNewUtf8 = void(*)(GDExtensionUninitializedStringPtr, const char*);

/// Construct a Godot String from Latin-1 C-string
using FnStringNewLatin1 = void(*)(GDExtensionUninitializedStringPtr, const char*);

/// Destroy a Godot String
using FnStringDestroy = void(*)(GDExtensionStringPtr);

/// Extract UTF-8 from a Godot String
using FnStringToUtf8 = GDExtensionInt(*)(GDExtensionConstStringPtr, char*, GDExtensionInt);

/// Set a Variant key/value
using FnVariantSet = void(*)(GDExtensionVariantPtr, GDExtensionConstVariantPtr,
                              GDExtensionConstVariantPtr, GDExtensionBool*);

/// PackedFloat32Array index access
using FnPFA32Index = const float*(*)(GDExtensionConstTypePtr, GDExtensionInt);

/// PackedFloat32Array size
using FnPFA32Size = GDExtensionInt(*)(GDExtensionConstTypePtr);

/// PackedFloat32Array destructor
using FnPFA32Destroy = void(*)(GDExtensionTypePtr);

// ── Opaque type sizes ───────────────────────────────────────────────────────
//
// Godot's opaque types have fixed in-memory sizes that we must match when
// allocating stack buffers. These were audited against Godot 4.7-dev2 source:
//
//   String:     CowData<char32_t> → single pointer → 8 bytes (arm64/x86_64)
//   StringName: single pointer → 8 bytes, padded to 16 for alignment safety
//   Variant:    up to 32 bytes (depends on float precision build config)
//
static constexpr std::size_t kVariantSize    = 32;
static constexpr std::size_t kStringNameSize = 16;
static constexpr std::size_t kStringSize     = 8;

/// StringName stack slot (kStringNameSize bytes, aligned to void*).
/// Must be destroyed after use via string_name_destroy / sn_destroy.
struct SNSlot {
  alignas(void*) uint8_t data[kStringNameSize] = {};
};

/// Variant stack slot (kVariantSize bytes, aligned to void*).
/// Must be destroyed after use via variant_destroy / var_destroy.
struct VSlot {
  alignas(void*) uint8_t data[kVariantSize] = {};
};

// ── Cached GDExtension function pointers ────────────────────────────────────
//
// Resolved once in gdext_initialize() at SCENE level, before live.store(true).
// The release/acquire fence on `live` provides the happens-before guarantee
// that all pointer fields are visible to consumer threads.
//

struct GDExtensionProcs {
  // ── Core Variant pipeline ─────────────────────────────────────────────
  FnSNNewLatin1    sn_new          = nullptr;  ///< string_name_new_with_latin1_chars
  FnSNDestroy      sn_destroy      = nullptr;  ///< string_name_destroy
  FnGetSingleton   get_singleton   = nullptr;  ///< global_get_singleton
  FnGetVarFromType get_var_from_type = nullptr; ///< get_variant_from_type_constructor
  FnGetTypeFromVar get_type_from_var = nullptr; ///< get_type_from_variant_constructor
  FnGetTypeFromVar get_var_to_type = nullptr;   ///< get_variant_to_type_constructor
  FnVariantCall    var_call        = nullptr;  ///< variant_call
  FnVariantNew     var_new_nil     = nullptr;  ///< variant_new_nil
  FnVariantDestroy var_destroy     = nullptr;  ///< variant_destroy

  // ── String operations ─────────────────────────────────────────────────
  FnStringNewUtf8   str_new_utf8   = nullptr;  ///< string_new_with_utf8_chars
  FnStringNewLatin1 str_new_latin1 = nullptr;  ///< string_new_with_latin1_chars
  FnStringDestroy   str_destroy    = nullptr;  ///< string_destroy
  FnStringToUtf8    str_to_utf8    = nullptr;  ///< string_to_utf8_chars

  // ── PackedFloat32Array operations ─────────────────────────────────────
  FnPFA32Index   pfa32_index   = nullptr;  ///< packed_float32_array_operator_index_const
  FnPFA32Size    pfa32_size    = nullptr;  ///< packed_float32_array_size
  FnPFA32Destroy pfa32_destroy = nullptr;  ///< packed_float32_array_destroy

  /// Resolve all function pointers from a GDExtension get_proc address.
  /// Call once during initialization (before setting live=true).
  /// Includes Godot 4.6-dev compatibility for renamed/removed API names.
  /// Returns true if all critical procs were resolved successfully.
  bool resolve(GDExtensionInterfaceGetProcAddress get_proc) {
    if (!get_proc) return false;

    // ── Helper: resolve a type destructor via variant_get_ptr_destructor ──
    // Several per-type destructors were removed in Godot 4.6-dev and must now
    // be looked up through variant_get_ptr_destructor(type).
    using FnGetPtrDestructor = void(*(*)(GDExtensionVariantType))(GDExtensionTypePtr);
    FnGetPtrDestructor dtor_getter = nullptr;
    {
      auto raw = get_proc("variant_get_ptr_destructor");
      if (raw) dtor_getter = reinterpret_cast<FnGetPtrDestructor>((void*)raw);
    }
    auto resolve_destructor = [&](GDExtensionVariantType type) -> void(*)(GDExtensionTypePtr) {
      if (!dtor_getter) return nullptr;
      return dtor_getter(type);
    };

    // ── Standard procs ───────────────────────────────────────────────────
    sn_new           = reinterpret_cast<FnSNNewLatin1>((void*)get_proc("string_name_new_with_latin1_chars"));
    get_singleton    = reinterpret_cast<FnGetSingleton>((void*)get_proc("global_get_singleton"));
    get_var_from_type = reinterpret_cast<FnGetVarFromType>((void*)get_proc("get_variant_from_type_constructor"));
    var_call         = reinterpret_cast<FnVariantCall>((void*)get_proc("variant_call"));
    var_new_nil      = reinterpret_cast<FnVariantNew>((void*)get_proc("variant_new_nil"));
    var_destroy      = reinterpret_cast<FnVariantDestroy>((void*)get_proc("variant_destroy"));
    str_new_utf8     = reinterpret_cast<FnStringNewUtf8>((void*)get_proc("string_new_with_utf8_chars"));
    str_new_latin1   = reinterpret_cast<FnStringNewLatin1>((void*)get_proc("string_new_with_latin1_chars"));
    str_to_utf8      = reinterpret_cast<FnStringToUtf8>((void*)get_proc("string_to_utf8_chars"));
    pfa32_index      = reinterpret_cast<FnPFA32Index>((void*)get_proc("packed_float32_array_operator_index_const"));

    // ── Compat: "get_type_from_variant_constructor" renamed to
    //    "get_variant_to_type_constructor" in Godot 4.6-dev ──────────────
    {
      auto fn = get_proc("get_variant_to_type_constructor");
      if (!fn) fn = get_proc("get_type_from_variant_constructor");  // fallback for older builds
      get_type_from_var = reinterpret_cast<FnGetTypeFromVar>((void*)fn);
      get_var_to_type   = get_type_from_var;  // alias — same function
    }

    // ── Compat: destructors removed in 4.6-dev — resolve via
    //    variant_get_ptr_destructor(type) ─────────────────────────────────
    {
      auto fn = get_proc("string_name_destroy");
      if (fn) {
        sn_destroy = reinterpret_cast<FnSNDestroy>((void*)fn);
      } else {
        sn_destroy = reinterpret_cast<FnSNDestroy>((void*)resolve_destructor(GDEXTENSION_VARIANT_TYPE_STRING_NAME));
      }
    }
    {
      auto fn = get_proc("string_destroy");
      if (fn) {
        str_destroy = reinterpret_cast<FnStringDestroy>((void*)fn);
      } else {
        str_destroy = reinterpret_cast<FnStringDestroy>((void*)resolve_destructor(GDEXTENSION_VARIANT_TYPE_STRING));
      }
    }
    {
      auto fn = get_proc("packed_float32_array_destroy");
      if (fn) {
        pfa32_destroy = reinterpret_cast<FnPFA32Destroy>((void*)fn);
      } else {
        pfa32_destroy = reinterpret_cast<FnPFA32Destroy>((void*)resolve_destructor(GDEXTENSION_VARIANT_TYPE_PACKED_FLOAT32_ARRAY));
      }
    }

    // ── Compat: packed_float32_array_size removed in 4.6-dev ────────────
    {
      auto fn = get_proc("packed_float32_array_size");
      pfa32_size = fn ? reinterpret_cast<FnPFA32Size>((void*)fn) : nullptr;
    }

    // Critical procs — messaging pipeline won't work without these
    return sn_new && get_singleton && get_var_from_type && var_call && var_destroy;
  }
};

}  // namespace margelo::nitro::godot
