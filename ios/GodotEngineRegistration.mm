///
/// GodotEngineRegistration.mm
///
/// Registers the HybridGodotEngine HybridObject into Nitro's HybridObjectRegistry
/// at app startup via Objective-C's +load mechanism.
///
/// Why +load and not __attribute__((constructor))?
///   On iOS, our library is a static archive (.a). The linker strips C++ constructor
///   functions (__attribute__((constructor))) from static libraries even when other
///   symbols from the same .o file ARE linked. However, the -ObjC linker flag (always
///   present in React Native projects) forces the linker to load ALL Objective-C
///   classes from static libraries — including their +load methods.
///
///   This guarantees the registration runs before any JS calls
///   NitroModules.createHybridObject("GodotEngine").
///

#import <Foundation/Foundation.h>
#include <NitroModules/HybridObjectRegistry.hpp>
#include "HybridGodotEngine.hpp"

@interface GodotEngineRegistration : NSObject
@end

@implementation GodotEngineRegistration

+ (void)load {
  NSLog(@"[NitroGodot] +load: Registering GodotEngine HybridObject");
  margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor(
    "GodotEngine",
    []() -> std::shared_ptr<margelo::nitro::HybridObject> {
      return std::make_shared<margelo::nitro::godot::HybridGodotEngine>();
    }
  );
}

@end
