///
/// GodotMetalView.mm
/// UIView subclass backed by CAMetalLayer for Godot Metal rendering on iOS.
///
/// Surface lifetime flow:
///   1. didMoveToWindow fires when the view is added to the window hierarchy
///   2. We extract (uintptr_t)self.layer → uint64_t pointer
///   3. We call onSurfaceCreated({ pointer: "0x..." }) → JS
///   4. JS calls engine.attachSurface(BigInt(pointer))  (via useGodotEngine hook)
///   5. willMoveToWindow:nil fires on teardown → onSurfaceDestroyed → engine.pause()
///

#import "GodotMetalView.h"
#import <React/RCTBridge.h>
#import <React/UIView+React.h>
#import <QuartzCore/CADisplayLink.h>

#include "../cpp/FrameCounters.hpp"

@implementation GodotMetalView {
  BOOL _surfaceEmitted;
  // Present instrumentation: a CADisplayLink on the main run loop ticks once per
  // display refresh the run loop actually serviced. Because the render loop
  // dispatch_syncs iteration() onto the main thread, these ticks only fire when
  // the main thread gets to breathe — so the tick rate is the real present rate,
  // and the produced-vs-presented gap (see FrameCounters.hpp) surfaces starvation.
  CADisplayLink* _presentLink;
  CFTimeInterval _lastPresentTs;
}

// ── Layer override ─────────────────────────────────────────────────────────

+ (Class)layerClass {
  // Back this view with a CAMetalLayer instead of the default CALayer.
  // This is the zero-copy path: Godot's Metal renderer writes directly to
  // the layer's drawable without any intermediate copy.
  return [CAMetalLayer class];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _surfaceEmitted = NO;

    CAMetalLayer* metalLayer = (CAMetalLayer*)self.layer;
    metalLayer.pixelFormat        = MTLPixelFormatBGRA8Unorm;
    metalLayer.framebufferOnly    = YES;
    metalLayer.contentsScale      = UIScreen.mainScreen.nativeScale;
    metalLayer.opaque             = YES;
  }
  return self;
}

// ── Window lifecycle ───────────────────────────────────────────────────────

- (void)didMoveToWindow {
  [super didMoveToWindow];

  if (self.window != nil && !_surfaceEmitted) {
    _surfaceEmitted = YES;

    // Extract UIView pointer — the bridge needs the view (not just
    // the layer) so it can add GDTView as a subview.
    uintptr_t viewPtr = (uintptr_t)self;
    NSString* hexPtr  = [NSString stringWithFormat:@"0x%llx", (unsigned long long)viewPtr];

    if (self.onSurfaceCreated) {
      self.onSurfaceCreated(@{ @"pointer": hexPtr });
    }

    [self startPresentLink];
  }
}

- (void)willMoveToWindow:(nullable UIWindow*)newWindow {
  [super willMoveToWindow:newWindow];

  if (newWindow == nil && _surfaceEmitted) {
    _surfaceEmitted = NO;
    [self stopPresentLink];
    if (self.onSurfaceDestroyed) {
      self.onSurfaceDestroyed(@{});
    }
  }
}

// ── Present-rate instrumentation ────────────────────────────────────────────

- (void)startPresentLink {
  if (_presentLink != nil) return;
  _lastPresentTs = 0;
  _presentLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(onPresentTick:)];
  [_presentLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

- (void)stopPresentLink {
  [_presentLink invalidate];
  _presentLink = nil;
}

- (void)onPresentTick:(CADisplayLink*)link {
  using namespace margelo::nitro::godot;
  g_frames_presented.fetch_add(1, std::memory_order_relaxed);
  if (_lastPresentTs > 0) {
    double dtUs = (link.timestamp - _lastPresentTs) * 1e6;
    if (dtUs > 0) recordPresentInterval(static_cast<uint64_t>(dtUs));
  }
  _lastPresentTs = link.timestamp;
}

- (void)dealloc {
  [self stopPresentLink];
}

// ── Layout ────────────────────────────────────────────────────────────────

- (void)layoutSubviews {
  [super layoutSubviews];
  // Keep the Metal layer's drawable size in sync with the view bounds
  CAMetalLayer* metalLayer  = (CAMetalLayer*)self.layer;
  CGFloat scale             = UIScreen.mainScreen.nativeScale;
  metalLayer.drawableSize   = CGSizeMake(self.bounds.size.width  * scale,
                                          self.bounds.size.height * scale);
}

// ── Touch Event Forwarding ────────────────────────────────────────────────
// Forward UIKit touch events to JS via onTouchEvent callback.
// JS side will call engine.sendTouchEvent() / engine.sendDragEvent()
// to inject these into Godot's Input system.

- (void)_emitTouchEvent:(NSString*)action withTouches:(NSSet<UITouch*>*)touches {
  if (!self.onTouchEvent) return;

  for (UITouch* touch in touches) {
    CGPoint point = [touch locationInView:self];
    CGPoint prevPoint = [touch previousLocationInView:self];
    CGFloat scale = UIScreen.mainScreen.nativeScale;

    // Use the touch pointer hash as a stable finger index
    // Map to 0-based by hashing — for single touch, always 0
    NSUInteger fingerIndex = 0;
    if (touches.count == 1) {
      fingerIndex = 0;
    } else {
      fingerIndex = [touch hash] % 10;
    }

    self.onTouchEvent(@{
      @"action": action,
      @"pointerId": @(fingerIndex),
      @"x": @(point.x * scale),
      @"y": @(point.y * scale),
      @"deltaX": @((point.x - prevPoint.x) * scale),
      @"deltaY": @((point.y - prevPoint.y) * scale),
    });
  }
}

- (void)touchesBegan:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
  [self _emitTouchEvent:@"down" withTouches:touches];
}

- (void)touchesMoved:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
  [self _emitTouchEvent:@"move" withTouches:touches];
}

- (void)touchesEnded:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
  [self _emitTouchEvent:@"up" withTouches:touches];
}

- (void)touchesCancelled:(NSSet<UITouch*>*)touches withEvent:(UIEvent*)event {
  [self _emitTouchEvent:@"up" withTouches:touches];
}

@end
