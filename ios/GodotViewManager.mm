///
/// GodotViewManager.mm
/// React Native RCTViewManager for GodotMetalView.
///
/// Registration name "GodotView" is used by requireNativeComponent('GodotView')
/// on the JS side, and by the GodotView.tsx wrapper component.
///

#import <React/RCTViewManager.h>
#import <React/RCTBridgeModule.h>
#import "GodotMetalView.h"

@interface GodotViewManager : RCTViewManager
@end

@implementation GodotViewManager

RCT_EXPORT_MODULE(GodotView)

- (UIView*)view {
  return [[GodotMetalView alloc] init];
}

// ── Event props ────────────────────────────────────────────────────────────
// These correspond to JS props passed to <GodotView onSurfaceCreated={...} />

RCT_EXPORT_VIEW_PROPERTY(onSurfaceCreated,  RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSurfaceDestroyed, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onTouchEvent,      RCTBubblingEventBlock)

// ── Required for RN's UIManager ────────────────────────────────────────────

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

@end
