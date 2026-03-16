#!/usr/bin/env node
/**
 * meshy_rigger.js — Automated Meshy AI Rigging & Animation Pipeline
 *
 * Triggers auto-rigging + animation via Meshy's /v2/animations endpoint,
 * polls until SUCCEEDED, then streams the resulting .glb to disk.
 *
 * Requirements: Node.js v22+ (native fetch, stream/promises)
 * Usage:
 *   MESHY_API_KEY=<key> node meshy_rigger.js [--model-id <id>] [--animation <name>] [--output <path>]
 *
 * Defaults:
 *   --model-id   019ce96a-d4c0-7198-b33c-ac4f12130b4c  (Sunny remeshed)
 *   --animation  idle
 *   --output     assets/models/heroes/sunny_idle.glb
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

// ─── Configuration ───────────────────────────────────────────────────────────

const MESHY_API_BASE = "https://api.meshy.ai";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 360; // 30 min ceiling

const MESHY_API_KEY = process.env.MESHY_API_KEY;
if (!MESHY_API_KEY) {
  console.error(
    "\x1b[31m✖ FATAL: MESHY_API_KEY environment variable is not set.\x1b[0m\n" +
      "  Export it before running:\n" +
      '  export MESHY_API_KEY="your-key-here"'
  );
  process.exit(1);
}

// ─── CLI Args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    "model-id": {
      type: "string",
      default: "019ce96a-d4c0-7198-b33c-ac4f12130b4c",
    },
    animation: { type: "string", default: "idle" },
    output: {
      type: "string",
      default: "assets/models/heroes/sunny_idle.glb",
    },
  },
  strict: false,
});

const MODEL_ID = args["model-id"];
const ANIMATION_NAME = args["animation"];
const OUTPUT_PATH = resolve(args["output"]);

// ─── API Helpers ─────────────────────────────────────────────────────────────

/**
 * Authenticated fetch wrapper with automatic JSON parsing and error handling.
 */
async function meshyFetch(path, options = {}) {
  const url = `${MESHY_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(
      `Meshy API ${res.status} ${res.statusText} — ${options.method ?? "GET"} ${path}\n  ${body}`
    );
  }

  return res.json();
}

/**
 * POST /v2/animations — Create a rigging + animation task.
 *
 * Setting `retargeting: true` triggers Meshy's auto-rigger before applying
 * the animation, which is exactly what we need for an un-rigged mesh.
 */
async function createAnimationTask(modelId, animationName) {
  const payload = {
    model_id: modelId,
    animation_name: animationName,
    retargeting: true,
  };

  console.log("\x1b[36m⟶  Creating animation task…\x1b[0m");
  console.log(`   model_id:       ${modelId}`);
  console.log(`   animation_name: ${animationName}`);
  console.log(`   retargeting:    true`);

  const data = await meshyFetch("/v2/animations", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const taskId = data.result ?? data.id ?? data.task_id;
  if (!taskId) {
    throw new Error(
      `Unexpected response — no task ID found:\n${JSON.stringify(data, null, 2)}`
    );
  }

  console.log(`\x1b[32m✔  Task created: ${taskId}\x1b[0m\n`);
  return taskId;
}

// ─── Polling ─────────────────────────────────────────────────────────────────

/**
 * Poll GET /v2/animations/{taskId} until terminal state.
 * Returns the full task object on SUCCEEDED.
 */
async function pollUntilComplete(taskId) {
  console.log("\x1b[36m⟶  Polling task status…\x1b[0m");

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const task = await meshyFetch(`/v2/animations/${taskId}`);
    const status = task.status;
    const progress = task.progress ?? "—";
    const elapsed = ((attempt * POLL_INTERVAL_MS) / 1000).toFixed(0);

    process.stdout.write(
      `\r   [${elapsed}s] Status: \x1b[33m${status}\x1b[0m  Progress: ${progress}%   `
    );

    if (status === "SUCCEEDED") {
      console.log(`\n\x1b[32m✔  Task SUCCEEDED after ~${elapsed}s\x1b[0m\n`);
      return task;
    }

    if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") {
      const errMsg = task.task_error?.message ?? task.error ?? "Unknown error";
      throw new Error(`Task ${status}: ${errMsg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Polling timed out after ${MAX_POLL_ATTEMPTS} attempts (~${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60_000} min)`
  );
}

// ─── File Download ───────────────────────────────────────────────────────────

/**
 * Stream the .glb binary from `downloadUrl` directly to `outputPath`.
 * Creates parent directories as needed.
 */
async function downloadGlb(downloadUrl, outputPath) {
  console.log(`\x1b[36m⟶  Downloading .glb asset…\x1b[0m`);
  console.log(`   URL:  ${downloadUrl.slice(0, 80)}…`);
  console.log(`   Dest: ${outputPath}`);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  // Stream the response body into a file (zero-copy via pipeline)
  const readableStream = Readable.fromWeb(res.body);
  const fileStream = createWriteStream(outputPath);

  await pipeline(readableStream, fileStream);

  // Report final size
  const { size } = await import("node:fs").then((fs) =>
    fs.promises.stat(outputPath)
  );
  const sizeMB = (size / 1024 / 1024).toFixed(2);

  console.log(
    `\x1b[32m✔  Saved: ${outputPath} (${sizeMB} MB)\x1b[0m\n`
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n\x1b[1m═══ Meshy Auto-Rigger & Animation Pipeline ═══\x1b[0m\n");

  // 1. Create the animation (+ auto-rig) task
  const taskId = await createAnimationTask(MODEL_ID, ANIMATION_NAME);

  // 2. Poll until done
  const completedTask = await pollUntilComplete(taskId);

  // 3. Resolve the download URL from the response
  const downloadUrl =
    completedTask.model_urls?.glb ??
    completedTask.model_url ??
    completedTask.downloadUrl ??
    completedTask.download_url;

  if (!downloadUrl) {
    console.error(
      "\x1b[33m⚠  No download URL in response. Full payload:\x1b[0m"
    );
    console.error(JSON.stringify(completedTask, null, 2));
    process.exit(1);
  }

  // 4. Stream to disk
  await downloadGlb(downloadUrl, OUTPUT_PATH);

  console.log("\x1b[1;32m═══ Pipeline complete ═══\x1b[0m\n");
}

main().catch((err) => {
  console.error(`\n\x1b[31m✖ Pipeline error:\x1b[0m ${err.message}`);
  if (err.cause) console.error("  Cause:", err.cause);
  process.exit(1);
});
