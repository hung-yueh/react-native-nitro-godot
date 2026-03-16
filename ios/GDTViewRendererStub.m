/**
 * GDTViewRendererStub.m
 *
 * No-op stub for GDTViewRenderer (stripped from libgodot.a).
 *
 * In a standard Godot iOS app, GDTViewRenderer drives the render loop:
 *   setupView: → setupProjectData → Main::setup2() → OS::start() → iterate()
 *
 * In React Native, we handle initialization and the render loop ourselves
 * (via HybridGodotEngine's render thread). If the REAL GDTViewRenderer is
 * left in libgodot.a, its setupProjectData calls Main::setup2() a SECOND
 * time when the CADisplayLink fires, causing "singleton already exists"
 * crashes for RendererCompositor, NavigationServer, etc.
 *
 * This stub satisfies the _OBJC_CLASS_$_GDTViewRenderer reference from
 * GDTViewController without triggering any Godot initialization.
 */
#import <UIKit/UIKit.h>

@protocol GDTViewRendererProtocol <NSObject>
- (BOOL)setupView:(UIView *)view;
- (void)renderOnView:(UIView *)view;
@end

@interface GDTViewRenderer : NSObject <GDTViewRendererProtocol>
@end

@implementation GDTViewRenderer

- (BOOL)setupView:(UIView *)view {
    // No-op: HybridGodotEngine handles Main::setup2() and Main::start()
    return NO;
}

- (void)renderOnView:(UIView *)view {
    // No-op: HybridGodotEngine drives iteration() from its render thread
}

@end
