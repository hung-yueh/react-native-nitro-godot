#!/usr/bin/env node
/**
 * meshy_rigger.js — Automated Meshy AI Rigging & Animation Pipeline
 *
 * Two-stage pipeline:
 *   Stage 1: POST /openapi/v1/rigging   → auto-rig the mesh
 *   Stage 2: POST /openapi/v1/animation → apply idle animation to rigged model
 *
 * Then polls each task and streams the final animated .glb to disk.
 *
 * Requirements: Node.js v22+ (native fetch, stream/promises)
 * Usage:
 *   MESHY_API_KEY=<key> node meshy_rigger.js [--model-id <id>] [--animation <name>] [--output <path>]
 */

import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";

// ─── Configuration ───────────────────────────────────────────────────────────

const MESHY_API_BASE = "https://api.meshy.ai/openapi";
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Generic Poller ──────────────────────────────────────────────────────────

async function pollTask(endpoint, taskId, label) {
  console.log(`\x1b[36m⟶  Polling ${label} task…\x1b[0m`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const task = await meshyFetch(`${endpoint}/${taskId}`);
    const status = task.status;
    const progress = task.progress ?? "—";
    const elapsed = ((attempt * POLL_INTERVAL_MS) / 1000).toFixed(0);

    process.stdout.write(
      `\r   [${elapsed}s] ${label}: \x1b[33m${status}\x1b[0m  Progress: ${progress}%   `
    );

    if (status === "SUCCEEDED") {
      console.log(`\n\x1b[32m✔  ${label} SUCCEEDED after ~${elapsed}s\x1b[0m\n`);
      return task;
    }

    if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") {
      const errMsg = task.task_error?.message ?? task.error ?? "Unknown error";
      throw new Error(`${label} ${status}: ${errMsg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`${label} timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}

// ─── Stage 1: Auto-Rigging ──────────────────────────────────────────────────

async function createRiggingTask(inputTaskId) {
  console.log("\x1b[1m── Stage 1: Auto-Rigging ──\x1b[0m\n");
  console.log(`\x1b[36m⟶  Creating rigging task…\x1b[0m`);
  console.log(`   input_task_id: ${inputTaskId}`);

  const data = await meshyFetch("/v1/rigging", {
    method: "POST",
    body: JSON.stringify({ input_task_id: inputTaskId }),
  });

  const taskId = data.result ?? data.id ?? data.task_id;
  if (!taskId) {
    throw new Error(
      `No task ID in rigging response:\n${JSON.stringify(data, null, 2)}`
    );
  }

  console.log(`\x1b[32m✔  Rigging task created: ${taskId}\x1b[0m\n`);
  return taskId;
}

// ─── Stage 2: Animation ─────────────────────────────────────────────────────

async function createAnimationTask(rigTaskId, animationName) {
  console.log("\x1b[1m── Stage 2: Animation ──\x1b[0m\n");
  console.log(`\x1b[36m⟶  Creating animation task…\x1b[0m`);
  console.log(`   rig_task_id:    ${rigTaskId}`);
  console.log(`   animation_name: ${animationName}`);

  // The animation endpoint needs a rig_task_id and action_id.
  // We'll pass the animation name as the action_id.
  const data = await meshyFetch("/v1/animation", {
    method: "POST",
    body: JSON.stringify({
      rig_task_id: rigTaskId,
      action_id: animationName,
    }),
  });

  const taskId = data.result ?? data.id ?? data.task_id;
  if (!taskId) {
    throw new Error(
      `No task ID in animation response:\n${JSON.stringify(data, null, 2)}`
    );
  }

  console.log(`\x1b[32m✔  Animation task created: ${taskId}\x1b[0m\n`);
  return taskId;
}

// ─── File Download ───────────────────────────────────────────────────────────

async function downloadGlb(downloadUrl, outputPath) {
  console.log(`\x1b[36m⟶  Downloading .glb asset…\x1b[0m`);
  console.log(`   URL:  ${downloadUrl.slice(0, 80)}…`);
  console.log(`   Dest: ${outputPath}`);

  await mkdir(dirname(outputPath), { recursive: true });

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const readableStream = Readable.fromWeb(res.body);
  const fileStream = createWriteStream(outputPath);
  await pipeline(readableStream, fileStream);

  const fileInfo = await stat(outputPath);
  const sizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);

  console.log(`\x1b[32m✔  Saved: ${outputPath} (${sizeMB} MB)\x1b[0m\n`);
}

// ─── Resolve download URL from a task result ─────────────────────────────────

function resolveDownloadUrl(task) {
  return (
    task.model_urls?.glb ??
    task.model_url ??
    task.downloadUrl ??
    task.download_url ??
    null
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    "\n\x1b[1m═══ Meshy Auto-Rigger & Animation Pipeline ═══\x1b[0m\n"
  );

  // Stage 1: Rig the mesh
  const rigTaskId = await createRiggingTask(MODEL_ID);
  const rigResult = await pollTask("/v1/rigging", rigTaskId, "Rigging");

  // Check if rigging alone has a downloadable .glb (some APIs bundle it)
  let downloadUrl = resolveDownloadUrl(rigResult);

  // Stage 2: Apply animation
  try {
    const animTaskId = await createAnimationTask(rigTaskId, ANIMATION_NAME);
    const animResult = await pollTask("/v1/animation", animTaskId, "Animation");
    const animUrl = resolveDownloadUrl(animResult);
    if (animUrl) downloadUrl = animUrl;
  } catch (err) {
    console.warn(
      `\x1b[33m⚠  Animation stage failed: ${err.message}\x1b[0m`
    );
    console.warn(
      "   Falling back to rigged-only model (no idle animation baked).\n"
    );
  }

  if (!downloadUrl) {
    console.error("\x1b[31m✖ No download URL found in either stage.\x1b[0m");
    console.error("Rigging result:", JSON.stringify(rigResult, null, 2));
    process.exit(1);
  }

  // Download to disk
  await downloadGlb(downloadUrl, OUTPUT_PATH);

  console.log("\x1b[1;32m═══ Pipeline complete ═══\x1b[0m\n");
}

main().catch((err) => {
  console.error(`\n\x1b[31m✖ Pipeline error:\x1b[0m ${err.message}`);
  if (err.cause) console.error("  Cause:", err.cause);
  process.exit(1);
});
