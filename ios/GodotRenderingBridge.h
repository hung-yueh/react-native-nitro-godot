/**
 * GodotRenderingBridge.h
 *
 * C-callable bridge for managing the Godot rendering connection
 * to the React Native view from HybridGodotEngine.cpp (pure C++).
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Stores the React Native UIView pointer for later use.
 * Must be called BEFORE libgodot_create_godot_instance().
 * @param view_ptr  A (void*) cast of the UIView* from GodotMetalView.
 */
void godot_rendering_bridge_set_layer(void* view_ptr);

/**
 * Sets up GDTView frames after Godot instance creation.
 * Must be called AFTER libgodot_create_godot_instance().
 */
void godot_rendering_bridge_apply_layer(void);

/**
 * Adds Godot's GDTView as a subview of the React Native view.
 * Must be called AFTER GodotInstance::start().
 */
void godot_rendering_bridge_connect_layer(void);

#ifdef __cplusplus
}
#endif
