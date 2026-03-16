/**
 * GDTAppDelegateServiceStub.m
 *
 * Provides a stub for GDTAppDelegateService (which we strip from libgodot.a)
 * and bridges Godot's internal GDTView to the React Native view hierarchy.
 *
 * Rendering strategy:
 *   We let Godot create its own GDTView and rendering layer normally.
 *   After start() completes, we add the GDTView as a subview of the
 *   React Native GodotMetalView so it appears on screen.
 *   This works with both OpenGL ES and Metal rendering backends.
 */
#import <UIKit/UIKit.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>
#import <objc/runtime.h>

// ─── Forward-declare classes from libgodot.a ─────────────────────────────────

@class GDTView;
@class GDTViewController;

@interface GDTViewController : UIViewController
@property (nonatomic, readonly, strong) GDTView *godotView;
@end

@interface GDTView : UIView
@property (strong, readonly, nonatomic) CALayer *renderingLayer;
- (CALayer *)initializeRenderingForDriver:(NSString *)driverName;
@end

// ─── Static storage ──────────────────────────────────────────────────────────

static UIView *_reactNativeView = nil;  // Our RN GodotMetalView

// ─── GDTAppDelegateService Stub ──────────────────────────────────────────────

@interface GDTAppDelegateService : NSObject
@property (class, nonatomic, strong) GDTViewController *viewController;
+ (void)setReactNativeView:(UIView *)view;
@end

@implementation GDTAppDelegateService

static GDTViewController *_viewController = nil;

+ (GDTViewController *)viewController {
    if (!_viewController) {
        _viewController = [[GDTViewController alloc] init];
        NSLog(@"[NitroGodot] Created GDTViewController %p", _viewController);
    }
    return _viewController;
}

+ (void)setViewController:(GDTViewController *)vc {
    _viewController = vc;
}

+ (void)setReactNativeView:(UIView *)view {
    NSLog(@"[NitroGodot] setReactNativeView: %p, frame=%@, layer=%@ (%p)",
          view, NSStringFromCGRect(view.frame), [view.layer class], view.layer);
    _reactNativeView = view;
}

// Call this AFTER libgodot_create_godot_instance() but BEFORE start().
// Sets up GDTView frames AND adds the view controller's view to the
// React Native view hierarchy. This is critical: Main::setup2() creates
// the DisplayServer which needs the GDTViewController in the window
// hierarchy for Metal rendering context creation. Without this, the
// DisplayServer's fallback loop re-creates RendererCompositor → crash.
+ (void)applyLayerToView {
    if (!_reactNativeView) {
        NSLog(@"[NitroGodot] applyLayerToView: no RN view stored!");
        return;
    }

    GDTViewController *vc = [self viewController];
    GDTView *godotView = vc.godotView;
    NSLog(@"[NitroGodot] applyLayerToView: vc=%p, godotView=%p", vc, godotView);

    // Set the view controller's view frame to match the RN view
    CGRect frame = _reactNativeView.bounds;
    vc.view.frame  = frame;
    vc.view.bounds = frame;

    if (godotView) {
        godotView.frame  = frame;
        godotView.bounds = frame;
        NSLog(@"[NitroGodot] applyLayerToView: godotView frame=%@", NSStringFromCGRect(frame));
    }

    // Add the vc.view to the RN view hierarchy NOW so that it's in the
    // window hierarchy when Main::setup2() creates the DisplayServer.
    [_reactNativeView addSubview:vc.view];
    NSLog(@"[NitroGodot] applyLayerToView: added vc.view to RN view hierarchy");
}

// Call this AFTER GodotInstance::start() to connect the rendering.
// Adds the GDTView (with its rendering layer intact) as a subview
// of the React Native view. This preserves OpenGL/Metal context bindings.
+ (void)connectRenderingToReactNativeView {
    if (!_reactNativeView) {
        NSLog(@"[NitroGodot] connectRendering: no RN view!");
        return;
    }

    GDTViewController *vc = [self viewController];
    GDTView *godotView = vc.godotView;
    CALayer *renderingLayer = godotView.renderingLayer;

    NSLog(@"[NitroGodot] connectRendering: godotView=%p, renderingLayer=%p (%@), RN view=%p",
          godotView, renderingLayer, renderingLayer ? NSStringFromClass([renderingLayer class]) : @"nil", _reactNativeView);

    if (!godotView) {
        NSLog(@"[NitroGodot] WARNING: godotView is nil after start()!");
        return;
    }

    // Set the GDTView's frame to fill the React Native view
    godotView.frame = _reactNativeView.bounds;

    // Add GDTView as a subview of the React Native view.
    // This keeps the rendering layer (OpenGL or Metal) within its
    // original superlayer (GDTView.layer), preserving framebuffer bindings.
    [_reactNativeView addSubview:godotView];

    NSLog(@"[NitroGodot] connectRendering: added godotView as subview. frame=%@, renderingLayer=%@",
          NSStringFromCGRect(godotView.frame),
          renderingLayer ? NSStringFromClass([renderingLayer class]) : @"nil");
}

@end
