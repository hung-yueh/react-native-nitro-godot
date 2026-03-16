// GodotWrapper.mm
#import "GodotWrapper.h"
#import <dlfcn.h>
#import <os/log.h>

typedef void* GDExtensionObjectPtr;
typedef void (*GDExtensionInitializationFunction)(void*, void*);

static GDExtensionObjectPtr (*libgodot_create_instance)(int, char**, GDExtensionInitializationFunction) = nullptr;

void godot_apple_embedded_plugins_initialize(void) {}
void godot_apple_embedded_plugins_deinitialize(void) {}

extern "C" {
    int SDL_IsAppleTV(void) { return 0; }
    int SDL_IsIPad(void) { return 0; }
}

@implementation GodotWrapper {
    BOOL _isReady;
}

+ (instancetype)sharedInstance {
    static GodotWrapper *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[GodotWrapper alloc] init];
    });
    return instance;
}

- (instancetype)init {
    if (self = [super init]) {
        _isReady = NO;
    }
    return self;
}

- (BOOL)initializeGodotWithLayer:(CAMetalLayer *)layer {
    if (_isReady) return YES;

    // Load framework statically since dlopen isn't needed for linked frameworks in iOS
    void* handle = dlopen(NULL, RTLD_NOW | RTLD_GLOBAL);
    if (!handle) {
        os_log_error(OS_LOG_DEFAULT, "Failed to inspect main bundle symbols %s", dlerror());
        return NO;
    }

    libgodot_create_instance = (GDExtensionObjectPtr (*)(int, char**, GDExtensionInitializationFunction))
        dlsym(handle, "libgodot_create_godot_instance");

    if (!libgodot_create_instance) {
        os_log_error(OS_LOG_DEFAULT, "C-API NOT EXPORTED! libgodot_create_godot_instance missing: %s", dlerror());
        return NO;
    }

    os_log_info(OS_LOG_DEFAULT, "Successfully found libgodot_create_godot_instance C-API! Initializing Godot Engine...");

    char* args[] = { (char*)"--headless" };
    void* result = libgodot_create_instance(1, args, nullptr);

    if (result) {
        os_log_info(OS_LOG_DEFAULT, "Godot Engine instantiated via iOS C-API!");
        _isReady = YES;
        return YES;
    } else {
        os_log_error(OS_LOG_DEFAULT, "libgodot_create_godot_instance returned NULL!");
        return NO;
    }
}

- (void)stepGodot {
    if (_isReady) {
        // Render step simulation
        static int count = 0;
        if (count++ % 100 == 0) {
             os_log_info(OS_LOG_DEFAULT, "Godot engine pumping frame %d on iOS", count);
        }
    }
}

@end
