// GodotWrapper.h
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface GodotWrapper : NSObject

+ (instancetype)sharedInstance;
- (BOOL)initializeGodotWithLayer:(CAMetalLayer *)layer;
- (void)stepGodot;

@end

NS_ASSUME_NONNULL_END
