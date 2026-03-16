import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import { File, Paths } from "expo-file-system";
import { Asset } from "expo-asset";
import { GodotView } from "react-native-nitro-godot";
import { NitroModules } from "react-native-nitro-modules";
import type { GodotEngine } from "react-native-nitro-godot";

// ─── Timing Helper ──────────────────────────────────────────────────────────

function timeExec<T>(fn: () => T): { result: T; ms: number } {
  const t0 = performance.now();
  const result = fn();
  const ms = performance.now() - t0;
  return { result, ms };
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: "pass" | "fail" | "pending";
  detail: string;
  timeMs?: number;
}

// ─── usePckExtract ──────────────────────────────────────────────────────────

function usePckExtract(pckModule: number) {
  const [pckPath, setPckPath] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function extract() {
      try {
        const asset = Asset.fromModule(pckModule);
        await asset.downloadAsync();

        const sourceUri = asset.localUri;
        if (!sourceUri)
          throw new Error("Asset localUri is null after downloadAsync");

        const destFile = new File(Paths.document, "game.pck");
        const srcFile = new File(sourceUri);

        const needsCopy =
          !destFile.exists ||
          (srcFile.exists && destFile.size !== srcFile.size);

        if (needsCopy) {
          if (destFile.exists) destFile.delete();
          srcFile.copy(destFile);
        }

        if (!cancelled) {
          setPckPath(destFile.uri);
          setExtracting(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Unknown error extracting PCK");
          setExtracting(false);
        }
      }
    }

    extract();
    return () => {
      cancelled = true;
    };
  }, [pckModule]);

  return { pckPath, extracting, error };
}

// ─── StatusBadge ────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  label,
}: {
  status: "pass" | "fail" | "pending";
  label: string;
}) {
  const color =
    status === "pass" ? "#4ade80" : status === "fail" ? "#f87171" : "#fbbf24";
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── MetricCard ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ─── ActionButton ───────────────────────────────────────────────────────────

function ActionButton({
  label,
  onPress,
  color = "#6366f1",
  small,
  disabled,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        { backgroundColor: disabled ? "#374151" : color },
        small && styles.actionBtnSmall,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text
        style={[
          styles.actionBtnText,
          small && styles.actionBtnTextSmall,
          disabled && { color: "#6b7280" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── GodotTestScreen ────────────────────────────────────────────────────────
// Uses NitroModules.createHybridObject() directly for MANUAL lifecycle control.
// This avoids the auto-start crash when the engine binary rejects --main-pack.

function GodotTestScreen({ pckPath }: { pckPath: string }) {
  // ── Engine ref (manually managed, NOT auto-started) ────────────────────
  const engineRef = useRef<GodotEngine | null>(null);
  const [engineState, setEngineState] = useState<
    "idle" | "created" | "initialized" | "started" | "paused" | "destroyed"
  >("idle");

  // ── State ──────────────────────────────────────────────────────────────
  const [surfacePtr, setSurfacePtr] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("hello-from-rn");
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  // ── Memory Metrics ─────────────────────────────────────────────────────
  const [allocatedHOs, setAllocatedHOs] = useState(0);
  const [registeredNames, setRegisteredNames] = useState<string[]>([]);
  const [nativeBuffersCreated, setNativeBuffersCreated] = useState(0);
  const nativeBufferRefs = useRef<ArrayBuffer[]>([]);

  // ── Performance Metrics ────────────────────────────────────────────────
  const [lastCallTimeMs, setLastCallTimeMs] = useState<number | null>(null);
  const [bufferThroughput, setBufferThroughput] = useState<string | null>(null);

  // ── Touch Forwarding ──────────────────────────────────────────────────
  const [touchCount, setTouchCount] = useState(0);
  const [lastTouchAction, setLastTouchAction] = useState<string>("—");
  const [lastTouchPos, setLastTouchPos] = useState("—");
  const [touchForwardingEnabled, setTouchForwardingEnabled] = useState(true);

  // ── Godot→JS Polling ──────────────────────────────────────────────────
  const [lastPolledMessage, setLastPolledMessage] = useState<string>("—");
  const [pollCount, setPollCount] = useState(0);

  // ── Refresh memory metrics ─────────────────────────────────────────────
  const refreshMetrics = useCallback(() => {
    try {
      const count = NitroModules.debug_getTotalAllocatedHybridObjects();
      setAllocatedHOs(count);
      const names = NitroModules.getAllHybridObjectNames();
      setRegisteredNames(names);
    } catch (e: any) {
      console.warn("Failed to refresh metrics:", e?.message);
    }
  }, []);

  // Auto-refresh metrics every 2s
  useEffect(() => {
    refreshMetrics();
    const interval = setInterval(refreshMetrics, 2000);
    return () => clearInterval(interval);
  }, [refreshMetrics]);

  // ── Add test result helper ─────────────────────────────────────────────
  const addResult = useCallback((r: TestResult) => {
    setTestResults((prev) => [r, ...prev].slice(0, 30));
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  //  LIFECYCLE API — all manual, each step triggered by a button
  // ══════════════════════════════════════════════════════════════════════════

  const handleCreate = useCallback(() => {
    try {
      const countBefore = NitroModules.debug_getTotalAllocatedHybridObjects();
      const { result: engine, ms } = timeExec(() =>
        NitroModules.createHybridObject<GodotEngine>("GodotEngine"),
      );
      const countAfter = NitroModules.debug_getTotalAllocatedHybridObjects();
      engineRef.current = engine;
      setEngineState("created");
      setLastCallTimeMs(ms);
      refreshMetrics();
      addResult({
        name: "createHybridObject",
        status: "pass",
        detail: `HOs: ${countBefore}→${countAfter}`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "createHybridObject",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult, refreshMetrics]);

  const handleInitialize = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({
        name: "initialize()",
        status: "fail",
        detail: "No engine — call Create first",
      });
      return;
    }
    try {
      const { ms } = timeExec(() => engine.initialize(pckPath));
      setEngineState("initialized");
      setLastCallTimeMs(ms);
      addResult({
        name: "initialize()",
        status: "pass",
        detail: `pck=${pckPath.split("/").pop()}`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "initialize()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [pckPath, addResult]);

  const handleStart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({
        name: "start()",
        status: "fail",
        detail: "No engine — call Create first",
      });
      return;
    }
    try {
      const { ms } = timeExec(() => engine.start());
      setEngineState("started");
      setLastCallTimeMs(ms);
      addResult({
        name: "start()",
        status: "pass",
        detail: "Render thread spawned",
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "start()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult]);

  const handlePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({ name: "pause()", status: "fail", detail: "No engine" });
      return;
    }
    try {
      const { ms } = timeExec(() => engine.pause());
      setEngineState("paused");
      setLastCallTimeMs(ms);
      addResult({
        name: "pause()",
        status: "pass",
        detail: "Engine paused",
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "pause()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult]);

  const handleDestroy = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({ name: "destroy()", status: "fail", detail: "No engine" });
      return;
    }
    try {
      const countBefore = NitroModules.debug_getTotalAllocatedHybridObjects();
      const { ms } = timeExec(() => engine.destroy());
      const countAfter = NitroModules.debug_getTotalAllocatedHybridObjects();
      setEngineState("destroyed");
      setLastCallTimeMs(ms);
      refreshMetrics();
      addResult({
        name: "destroy()",
        status: "pass",
        detail: `HOs: ${countBefore}→${countAfter}`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "destroy()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult, refreshMetrics]);

  // ══════════════════════════════════════════════════════════════════════════
  //  SURFACE / VIEW BINDING
  // ══════════════════════════════════════════════════════════════════════════

  const handleSurfaceCreated = useCallback(
    (event: any) => {
      const { pointer } = event.nativeEvent;
      setSurfacePtr(pointer);
      const engine = engineRef.current;
      if (!engine) {
        addResult({
          name: "onSurfaceCreated",
          status: "pending",
          detail: `ptr=${pointer} (engine not created yet)`,
        });
        return;
      }
      try {
        const { ms } = timeExec(() => engine.attachSurface(BigInt(pointer)));
        setLastCallTimeMs(ms);
        addResult({
          name: "attachSurface",
          status: "pass",
          detail: `ptr=${pointer}`,
          timeMs: ms,
        });
      } catch (e: any) {
        addResult({
          name: "attachSurface",
          status: "fail",
          detail: e?.message ?? "Unknown error",
        });
      }
    },
    [addResult],
  );

  const handleAttachSurface = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !surfacePtr) {
      addResult({
        name: "attachSurface",
        status: "fail",
        detail: !engine ? "No engine" : "No surface pointer yet",
      });
      return;
    }
    try {
      const { ms } = timeExec(() => engine.attachSurface(BigInt(surfacePtr)));
      setLastCallTimeMs(ms);
      addResult({
        name: "attachSurface",
        status: "pass",
        detail: `ptr=${surfacePtr}`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "attachSurface",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [surfacePtr, addResult]);

  const handleSurfaceDestroyed = useCallback(() => {
    setSurfacePtr(null);
    addResult({
      name: "onSurfaceDestroyed",
      status: "pass",
      detail: "Surface destroyed",
    });
  }, [addResult]);

  // ══════════════════════════════════════════════════════════════════════════
  //  MESSAGING
  // ══════════════════════════════════════════════════════════════════════════

  const handleSendMessage = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({ name: "sendMessage()", status: "fail", detail: "No engine" });
      return;
    }
    const msg = `${messageText}-${Date.now()}`;
    try {
      const { ms } = timeExec(() => engine.sendMessage(msg));
      setLastCallTimeMs(ms);
      addResult({
        name: "sendMessage()",
        status: "pass",
        detail: `"${msg}"`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "sendMessage()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [messageText, addResult]);

  // ══════════════════════════════════════════════════════════════════════════
  //  TOUCH INPUT FORWARDING
  // ══════════════════════════════════════════════════════════════════════════

  const handleTouchEvent = useCallback(
    (event: any) => {
      const { action, pointerId, x, y, deltaX, deltaY } = event.nativeEvent;
      setTouchCount((c) => c + 1);
      setLastTouchAction(`${action} #${pointerId}`);
      setLastTouchPos(`${Math.round(x)}, ${Math.round(y)}`);

      if (!touchForwardingEnabled) return;
      const engine = engineRef.current;
      if (!engine) return;

      try {
        if (action === "down") {
          engine.sendTouchEvent(x, y, true, pointerId);
        } else if (action === "up") {
          engine.sendTouchEvent(x, y, false, pointerId);
        } else if (action === "move") {
          engine.sendDragEvent(x, y, deltaX, deltaY, 0, 0, pointerId);
        }
      } catch (e: any) {
        addResult({
          name: `touch:${action}`,
          status: "fail",
          detail: e?.message ?? "Unknown error",
        });
      }
    },
    [touchForwardingEnabled, addResult],
  );

  // ══════════════════════════════════════════════════════════════════════════
  //  GODOT→JS POLLING
  // ══════════════════════════════════════════════════════════════════════════

  const handlePollMessage = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({ name: "pollMessage()", status: "fail", detail: "No engine" });
      return;
    }
    try {
      const { result: msg, ms } = timeExec(() => engine.pollMessage());
      setPollCount((c) => c + 1);
      setLastCallTimeMs(ms);
      if (msg && msg.length > 0) {
        setLastPolledMessage(msg);
        addResult({
          name: "pollMessage()",
          status: "pass",
          detail: `"${msg.substring(0, 60)}"`,
          timeMs: ms,
        });
      } else {
        addResult({
          name: "pollMessage()",
          status: "pass",
          detail: "(empty — no message queued)",
          timeMs: ms,
        });
      }
    } catch (e: any) {
      addResult({
        name: "pollMessage()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult]);

  // ══════════════════════════════════════════════════════════════════════════
  //  SHARED BUFFER
  // ══════════════════════════════════════════════════════════════════════════

  const handleTestBuffer = useCallback(
    (sizeBytes: number) => {
      const label =
        sizeBytes >= 1024 * 1024
          ? `${(sizeBytes / 1024 / 1024).toFixed(0)}MB`
          : `${(sizeBytes / 1024).toFixed(0)}KB`;
      const engine = engineRef.current;
      if (!engine) {
        addResult({
          name: `updateSharedBuffer(${label})`,
          status: "fail",
          detail: "No engine",
        });
        return;
      }
      try {
        const buffer = new ArrayBuffer(sizeBytes);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < Math.min(view.length, 256); i++) {
          view[i] = i & 0xff;
        }
        const { ms } = timeExec(() => engine.updateSharedBuffer(buffer));
        const throughput =
          ms > 0
            ? `${(sizeBytes / 1024 / 1024 / (ms / 1000)).toFixed(1)} MB/s`
            : "∞";
        setBufferThroughput(throughput);
        setLastCallTimeMs(ms);
        addResult({
          name: `updateSharedBuffer(${label})`,
          status: "pass",
          detail: `${throughput} throughput`,
          timeMs: ms,
        });
      } catch (e: any) {
        addResult({
          name: `updateSharedBuffer(${label})`,
          status: "fail",
          detail: e?.message ?? "Unknown error",
        });
      }
    },
    [addResult],
  );

  // ══════════════════════════════════════════════════════════════════════════
  //  NITRO MEMORY TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  const handleCreateNativeBuffer = useCallback(
    (sizeBytes: number) => {
      try {
        const { result: buf, ms } = timeExec(() =>
          NitroModules.createNativeArrayBuffer(sizeBytes),
        );
        nativeBufferRefs.current.push(buf);
        setNativeBuffersCreated((c) => c + 1);
        setLastCallTimeMs(ms);
        refreshMetrics();
        addResult({
          name: `createNativeArrayBuffer(${sizeBytes})`,
          status: "pass",
          detail: `byteLength=${buf.byteLength}`,
          timeMs: ms,
        });
      } catch (e: any) {
        addResult({
          name: "createNativeArrayBuffer",
          status: "fail",
          detail: e?.message ?? "Unknown error",
        });
      }
    },
    [addResult, refreshMetrics],
  );

  const handleUpdateMemorySize = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({
        name: "updateMemorySize",
        status: "fail",
        detail: "No engine",
      });
      return;
    }
    try {
      const { ms } = timeExec(() => NitroModules.updateMemorySize(engine));
      setLastCallTimeMs(ms);
      refreshMetrics();
      addResult({
        name: "updateMemorySize()",
        status: "pass",
        detail: "Re-calculated",
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "updateMemorySize()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult, refreshMetrics]);

  const handleDispose = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      addResult({ name: "dispose()", status: "fail", detail: "No engine" });
      return;
    }
    try {
      const countBefore = NitroModules.debug_getTotalAllocatedHybridObjects();
      const { ms } = timeExec(() => engine.dispose());
      const countAfter = NitroModules.debug_getTotalAllocatedHybridObjects();
      engineRef.current = null;
      setEngineState("idle");
      setLastCallTimeMs(ms);
      refreshMetrics();
      addResult({
        name: "dispose()",
        status: "pass",
        detail: `HOs: ${countBefore}→${countAfter}`,
        timeMs: ms,
      });
    } catch (e: any) {
      addResult({
        name: "dispose()",
        status: "fail",
        detail: e?.message ?? "Unknown error",
      });
    }
  }, [addResult, refreshMetrics]);

  const handleReleaseBuffers = useCallback(() => {
    const count = nativeBufferRefs.current.length;
    nativeBufferRefs.current = [];
    setNativeBuffersCreated(0);
    refreshMetrics();
    addResult({
      name: "Release Buffers",
      status: "pass",
      detail: `Released ${count} (GC pending)`,
    });
  }, [addResult, refreshMetrics]);

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const stateColor =
    engineState === "started"
      ? "#4ade80"
      : engineState === "destroyed" || engineState === "idle"
        ? "#6b7280"
        : "#fbbf24";

  return (
    <View style={styles.root}>
      {/* ── App Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLogoMark}>
          <Text style={styles.headerLogoText}>⬡</Text>
        </View>
        <View>
          <Text style={styles.headerTitle}>
            NitroGodot<Text style={styles.headerTitleAccent}> Lab</Text>
          </Text>
          <Text style={styles.headerSubtitle}>
            react-native-nitro-godot · API test harness
          </Text>
        </View>
      </View>

      {/* ── Godot Render Surface (top ~28%) ── */}
      <View style={styles.godotContainer}>
        <GodotView
          style={StyleSheet.absoluteFill}
          onSurfaceCreated={handleSurfaceCreated}
          onSurfaceDestroyed={handleSurfaceDestroyed}
          onTouchEvent={handleTouchEvent}
        />
        <View style={styles.statusOverlay} pointerEvents="none">
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
            <Text style={styles.statusText}>
              {engineState.toUpperCase()}
              {surfacePtr ? ` • sfc=${surfacePtr.slice(0, 10)}…` : ""}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Test Controls (bottom 70%) ── */}
      <ScrollView
        style={styles.controlsContainer}
        contentContainerStyle={styles.controlsContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Nitro Runtime Info ── */}
        <SectionHeader title="Nitro Runtime" icon="⚡" />
        <View style={styles.metricsRow}>
          <MetricCard label="Build" value={NitroModules.buildType} />
          <MetricCard label="Version" value={NitroModules.version} />
          <MetricCard label="Platform" value={Platform.OS} />
        </View>

        {/* ── Memory Metrics ── */}
        <SectionHeader title="Memory Tracker" icon="🧠" />
        <View style={styles.metricsRow}>
          <MetricCard label="Allocated HOs" value={allocatedHOs} />
          <MetricCard label="Native Bufs" value={nativeBuffersCreated} />
          <MetricCard
            label="Last Call"
            value={lastCallTimeMs !== null ? lastCallTimeMs.toFixed(2) : "—"}
            unit="ms"
          />
        </View>
        {bufferThroughput && (
          <View style={styles.metricsRow}>
            <MetricCard label="Throughput" value={bufferThroughput} />
          </View>
        )}

        {/* Registered names */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Registered HybridObjects</Text>
          <Text style={styles.panelMono}>
            {registeredNames.length > 0 ? registeredNames.join(", ") : "(none)"}
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <ActionButton
            label="🔄 Refresh"
            onPress={refreshMetrics}
            color="#0ea5e9"
            small
          />
          <ActionButton
            label="📏 Update MemSize"
            onPress={handleUpdateMemorySize}
            color="#8b5cf6"
            small
          />
        </View>

        {/* ── Lifecycle API (MANUAL) ── */}
        <SectionHeader title="Engine Lifecycle" icon="🔄" />
        <Text style={styles.hintText}>
          Each step is manual. Flow: Create → Initialize → Start → Pause/Destroy
        </Text>
        <View style={styles.buttonRow}>
          <ActionButton
            label="➕ Create"
            onPress={handleCreate}
            color="#10b981"
            disabled={engineState !== "idle" && engineState !== "destroyed"}
          />
          <ActionButton
            label="⚙️ Initialize"
            onPress={handleInitialize}
            color="#0ea5e9"
            disabled={engineState !== "created"}
          />
        </View>
        <View style={styles.buttonRow}>
          <ActionButton
            label="▶️ Start"
            onPress={handleStart}
            color="#6366f1"
            disabled={engineState !== "initialized" && engineState !== "paused"}
          />
          <ActionButton
            label="⏸ Pause"
            onPress={handlePause}
            color="#f59e0b"
            disabled={engineState !== "started"}
          />
        </View>
        <View style={styles.buttonRow}>
          <ActionButton
            label="🛑 Destroy"
            onPress={handleDestroy}
            color="#ef4444"
            disabled={engineState === "idle" || engineState === "destroyed"}
          />
          <ActionButton
            label="🗑 Dispose HO"
            onPress={handleDispose}
            color="#dc2626"
            disabled={engineState === "idle"}
          />
        </View>

        {/* ── View Binding ── */}
        <SectionHeader title="View Binding" icon="🖥" />
        <View style={styles.buttonRow}>
          <ActionButton
            label="🔗 Attach Surface"
            onPress={handleAttachSurface}
            color="#0891b2"
            disabled={!surfacePtr || engineState === "idle"}
          />
        </View>

        {/* ── Touch Input Forwarding ── */}
        <SectionHeader title="Touch Input Forwarding" icon="👆" />
        <Text style={styles.hintText}>
          Touch the Godot surface above — events are forwarded to Godot's Input
          system
        </Text>
        <View style={styles.metricsRow}>
          <MetricCard label="Touch Events" value={touchCount} />
          <MetricCard label="Last Action" value={lastTouchAction} />
          <MetricCard label="Last Pos" value={lastTouchPos} />
        </View>
        <View style={styles.buttonRow}>
          <ActionButton
            label={
              touchForwardingEnabled ? "🟢 Forwarding ON" : "🔴 Forwarding OFF"
            }
            onPress={() => setTouchForwardingEnabled((v) => !v)}
            color={touchForwardingEnabled ? "#10b981" : "#ef4444"}
            small
          />
          <ActionButton
            label="Reset Count"
            onPress={() => {
              setTouchCount(0);
              setLastTouchAction("—");
              setLastTouchPos("—");
            }}
            color="#6b7280"
            small
          />
        </View>

        {/* ── Godot→JS Messaging ── */}
        <SectionHeader title="Godot → JS Polling" icon="📬" />
        <Text style={styles.hintText}>
          Godot scripts call RNBridge.send_to_react_native() — JS retrieves via
          pollMessage()
        </Text>
        <View style={styles.metricsRow}>
          <MetricCard label="Polls" value={pollCount} />
          <MetricCard label="Last Message" value={lastPolledMessage} />
        </View>
        <View style={styles.buttonRow}>
          <ActionButton
            label="📬 Poll Message"
            onPress={handlePollMessage}
            color="#8b5cf6"
          />
        </View>

        {/* ── JS→Godot Messaging ── */}
        <SectionHeader title="JS → Godot Messaging" icon="📨" />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Message to Godot…"
            placeholderTextColor="#6b7280"
          />
          <ActionButton
            label="Send"
            onPress={handleSendMessage}
            color="#6366f1"
            small
          />
        </View>

        {/* ── SharedBuffer Tests ── */}
        <SectionHeader title="Zero-Copy SharedBuffer" icon="📦" />
        <View style={styles.buttonRow}>
          <ActionButton
            label="1 KB"
            onPress={() => handleTestBuffer(1024)}
            color="#10b981"
            small
          />
          <ActionButton
            label="1 MB"
            onPress={() => handleTestBuffer(1024 * 1024)}
            color="#10b981"
            small
          />
          <ActionButton
            label="10 MB"
            onPress={() => handleTestBuffer(10 * 1024 * 1024)}
            color="#10b981"
            small
          />
        </View>

        {/* ── Native ArrayBuffer ── */}
        <SectionHeader title="Native ArrayBuffer" icon="🧪" />
        <View style={styles.buttonRow}>
          <ActionButton
            label="Alloc 1KB"
            onPress={() => handleCreateNativeBuffer(1024)}
            color="#0891b2"
            small
          />
          <ActionButton
            label="Alloc 1MB"
            onPress={() => handleCreateNativeBuffer(1024 * 1024)}
            color="#0891b2"
            small
          />
          <ActionButton
            label="Release All"
            onPress={handleReleaseBuffers}
            color="#dc2626"
            small
          />
        </View>

        {/* ── Test Results Log ── */}
        <SectionHeader title="Test Results" icon="📋" />
        {testResults.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.emptyText}>
              Run a test to see results here…
            </Text>
          </View>
        ) : (
          testResults.map((r, i) => (
            <View key={`${r.name}-${i}`} style={styles.resultRow}>
              <StatusBadge status={r.status} label={r.name} />
              <View style={styles.resultDetail}>
                <Text style={styles.resultDetailText} numberOfLines={1}>
                  {r.detail}
                </Text>
                {r.timeMs !== undefined && (
                  <Text style={styles.resultTime}>{r.timeMs.toFixed(2)}ms</Text>
                )}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── App Root ───────────────────────────────────────────────────────────────

export default function App() {
  const PCK_MODULE = require("./assets/game.pck") as number;
  const { pckPath, extracting, error } = usePckExtract(PCK_MODULE);

  if (extracting) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Extracting game assets…</Text>
      </SafeAreaView>
    );
  }

  if (error || !pckPath) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>Failed to load game.pck:</Text>
        <Text style={styles.errorDetail}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <GodotTestScreen pckPath={pckPath} />
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f0f14",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "600",
  },
  errorDetail: {
    color: "#fca5a5",
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // ── Godot render area ──
  godotContainer: {
    height: 100,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e2e",
    overflow: "hidden",
  },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 12,
  },
  statusBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: "#d1d5db",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // ── Controls area ──
  controlsContainer: {
    flex: 1,
  },
  controlsContent: {
    padding: 16,
    gap: 10,
  },

  // ── Section headers ──
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  sectionIcon: {
    fontSize: 16,
  },
  sectionTitle: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  // ── Hint text ──
  hintText: {
    color: "#6b7280",
    fontSize: 11,
    fontStyle: "italic",
    marginBottom: 4,
  },

  // ── Metric cards ──
  metricsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metricCard: {
    flex: 1,
    minWidth: 90,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricLabel: {
    color: "#9ca3af",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricValue: {
    color: "#f9fafb",
    fontSize: 18,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  metricUnit: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "400",
  },

  // ── Panels ──
  panel: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 12,
  },
  panelTitle: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  panelMono: {
    color: "#a5b4fc",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },

  // ── Buttons ──
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  actionBtn: {
    flex: 1,
    minWidth: 80,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnSmall: {
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  actionBtnTextSmall: {
    fontSize: 12,
  },

  // ── Text input ──
  inputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  textInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    color: "#f9fafb",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // ── Status badges ──
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // ── Test results ──
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  resultDetail: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  resultDetailText: {
    flex: 1,
    color: "#9ca3af",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  resultTime: {
    color: "#6366f1",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  emptyText: {
    color: "#4b5563",
    fontSize: 12,
    textAlign: "center",
    fontStyle: "italic",
  },

  // ── App header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  headerLogoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  headerLogoText: {
    fontSize: 20,
    color: "#fff",
    lineHeight: 24,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f9fafb",
    letterSpacing: -0.3,
  },
  headerTitleAccent: {
    color: "#818cf8",
  },
  headerSubtitle: {
    fontSize: 10,
    color: "#6b7280",
    letterSpacing: 0.2,
    marginTop: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
