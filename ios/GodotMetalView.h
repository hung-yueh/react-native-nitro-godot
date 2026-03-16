#pragma once

#import <UIKit/UIKit.h>
#import <QuartzCore/CAMetalLayer.h>
#import <React/RCTComponent.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * GodotMetalView — UIView backed by a CAMetalLayer for Godot Metal rendering.
 *
 * When the view moves into the window hierarchy (didMoveToWindow), it extracts
 * the CAMetalLayer pointer and fires the onSurfaceCreated JS event with the
 * raw pointer encoded as a hex string. JS calls:
 *   engine.attachSurface(BigInt("0x<ptr>"))
 *
 * The pointer stays valid for the lifetime of this view/layer.
 */
@interface GodotMetalView : UIView

/// JS callback blocks — set by GodotViewManager via RCT_EXPORT_VIEW_PROPERTY
@property (nonatomic, copy, nullable) RCTBubblingEventBlock onSurfaceCreated;
@property (nonatomic, copy, nullable) RCTBubblingEventBlock onSurfaceDestroyed;
@property (nonatomic, copy, nullable) RCTBubblingEventBlock onTouchEvent;

@end

NS_ASSUME_NONNULL_END
