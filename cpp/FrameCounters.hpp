#pragma once

#include <atomic>
#include <cstdint>

// Cross-language frame counters shared between the C++ render loop
// (HybridGodotEngine.cpp) and the iOS present instrumentation
// (GodotMetalView.mm, ObjC++). See getFrameStats() for how these are turned
// into producedFps / presentedFps / worstFrameMs.
namespace margelo::nitro::godot {

// Incremented on the render thread after each completed iteration()/present.
extern std::atomic<uint64_t> g_frames_produced;

// Incremented on the MAIN thread by a CADisplayLink, once per display tick the
// main run loop actually serviced (i.e. a real present opportunity). When the
// main thread is starved this lags g_frames_produced — that gap is the bug we
// want to surface. iOS only; stays 0 where there is no present instrumentation.
extern std::atomic<uint64_t> g_frames_presented;

// Longest gap (microseconds) between consecutive present ticks since the last
// read. Reset to 0 when read by getFrameStats().
extern std::atomic<uint64_t> g_worst_present_us;

// Record one inter-present interval (microseconds); keeps the running max.
// Safe to call from the main thread (the present-tick callback).
inline void recordPresentInterval(uint64_t micros) {
  uint64_t cur = g_worst_present_us.load(std::memory_order_relaxed);
  while (micros > cur &&
         !g_worst_present_us.compare_exchange_weak(cur, micros,
                                                   std::memory_order_relaxed)) {
    // cur is reloaded by compare_exchange_weak on failure.
  }
}

}  // namespace margelo::nitro::godot
