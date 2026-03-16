#!/usr/bin/env python3
# =============================================================================
# gen_test_pck.py – Generates a minimal valid Godot PCK v2
# =============================================================================
# Creates a minimal 'test.pck' file with the correct magic bytes (GDPC), version,
# and zero files. This allows testing the Godot Engine's PCK mounting ability
# without requiring a full Godot Editor export.
# =============================================================================

import struct

PCK_MAGIC = b'GDPC'  # 0x43504447
PCK_VERSION = 2
MAJOR = 4
MINOR = 4
PATCH = 0
FILE_COUNT = 0

with open("test.pck", "wb") as f:
    # 1. Magic 'GDPC' (4 bytes)
    f.write(PCK_MAGIC)
    # 2. PCK formatting version (uint32) = 2 for Godot 4.x
    f.write(struct.pack("<I", PCK_VERSION))
    # 3. Godot Major (uint32)
    f.write(struct.pack("<I", MAJOR))
    # 4. Godot Minor (uint32)
    f.write(struct.pack("<I", MINOR))
    # 5. Godot Patch (uint32)
    f.write(struct.pack("<I", PATCH))
    # 6. Flags (uint32) = 0
    f.write(struct.pack("<I", 0))
    # 7. File offset to start of file array (uint64)
    # The header size for PCK v2 is: 4 + (4*5) + 8 = 32 bytes
    # But files array follows immediately, we set it to 0 as there are 0 files.
    file_base = 32 + (4 * 16) # padding
    f.write(struct.pack("<Q", file_base))
    # 8. Reserved bytes (16 * uint32 = 64 bytes)
    f.write(b'\x00' * 64)
    # 9. File Count (uint32) = 0
    f.write(struct.pack("<I", FILE_COUNT))

print("Created 'test.pck' (minimal Godot PCK v2).")
