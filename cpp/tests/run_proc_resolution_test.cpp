// Standalone host runner for the GDExtension proc-resolution shim test.
//
// Compiles GDExtensionProcs::resolve() against a mock get_proc that simulates a
// "new Godot" (renamed/removed API names) and asserts every critical proc still
// resolves. This is the regression guard for the class of bug where a Godot API
// rename silently nulls a critical function pointer and breaks the Godot→JS
// message pipeline (exactly the risk exercised by each engine version bump).
//
// Run via:  npm run test:cpp   (see cpp/tests/run_proc_resolution_test.sh)

#define TEST_PROC_RESOLUTION
#include "test_proc_resolution.h"

int main() {
  // The static ProcResolutionTestRunner above already executed at load time and
  // logged results; re-run explicitly so the process exit code reflects pass/fail.
  return proc_resolution_test::run_proc_resolution_tests() ? 0 : 1;
}
