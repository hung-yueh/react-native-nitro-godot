/**
 * GodotRenderingBridge.mm
 *
 * ObjC implementation of the rendering bridge — calls into
 * GDTAppDelegateServiceStub to manage the Godot view connection.
 */
#import "GodotRenderingBridge.h"
#import <UIKit/UIKit.h>

// Forward-declare the stub class (defined in GDTAppDelegateServiceStub.m)
@interface GDTAppDelegateService : NSObject
+ (void)setReactNativeView:(UIView *)view;
+ (void)applyLayerToView;
+ (void)connectRenderingToReactNativeView;
@end

void godot_rendering_bridge_set_layer(void* view_ptr) {
    UIView *view = (__bridge UIView *)view_ptr;
    [GDTAppDelegateService setReactNativeView:view];
}

void godot_rendering_bridge_apply_layer(void) {
    [GDTAppDelegateService applyLayerToView];
}

void godot_rendering_bridge_connect_layer(void) {
    [GDTAppDelegateService connectRenderingToReactNativeView];
}
