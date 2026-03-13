import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const {
  PORT = 3001,
  KIBANA_URL,
  AGENT_ID,
  API_KEY,
  A2A_METHOD = "message/send",
  POLL_INTERVAL_MS = 1000,
  MAX_POLL_ATTEMPTS = 20,
} = process.env;

if (!KIBANA_URL || !AGENT_ID || !API_KEY) {
  console.warn("Missing required env vars: KIBANA_URL, AGENT_ID, API_KEY");
}

const A2A_ENDPOINT = () => `${KIBANA_URL.replace(/\/$/, "")}/api/agent_builder/a2a/${AGENT_ID}`;

// A2A performance configuration
const A2A_TIMEOUT_MS = 30000; // 30 second timeout per request
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2500, 6000]; // Exponential backoff delays in ms

const TERMINAL_STATES = new Set(["completed", "failed", "canceled", "rejected"]);

function buildJsonRpc(method, params) {
  return {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params,
  };
}

function mapRole(role) {
  if (role === "assistant") return "assistant";
  return "user";
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const role = mapRole(typeof entry.role === "string" ? entry.role.trim().toLowerCase() : "user");
  let text = "";

  if (typeof entry.text === "string") {
    text = entry.text;
  } else if (typeof entry.message === "string") {
    text = entry.message;
  } else if (Array.isArray(entry.parts)) {
    text = entry.parts
      .filter((p) => p && p.kind === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }

  const cleaned = text.trim();
  if (!cleaned) return null;
  return { role, text: cleaned };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.map(normalizeHistoryEntry).filter(Boolean);
}

function buildTranscript(currentMessage, history) {
  const lines = [];

  for (const item of history) {
    const speaker = item.role === "assistant" ? "Assistant" : "User";
    lines.push(`${speaker}: ${item.text}`);
  }

  if (!history.length || history[history.length - 1].text !== currentMessage) {
    lines.push(`User: ${currentMessage}`);
  }

  return lines.join("\n\n");
}

function messageSendParams(text, history = []) {
  const payloadText = history.length ? buildTranscript(text, history) : text;
  return {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      parts: [{ kind: "text", text: payloadText }],
    },
  };
}

function extractTextFromMessage(message) {
  if (!message || !Array.isArray(message.parts)) return null;
  const textParts = message.parts
    .filter((p) => p && p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text.trim())
    .filter(Boolean);
  return textParts.length ? textParts.join("\n") : null;
}

function extractTextFromTask(task) {
  if (!task) return null;

  const statusMsg = task.status && task.status.message;
  const statusText = extractTextFromMessage(statusMsg);
  if (statusText) return statusText;

  if (Array.isArray(task.history)) {
    const lastAgentMsg = [...task.history]
      .reverse()
      .find((m) => m && m.role === "assistant");
    const historyText = extractTextFromMessage(lastAgentMsg);
    if (historyText) return historyText;
  }

  if (Array.isArray(task.artifacts)) {
    for (const artifact of task.artifacts) {
      if (!artifact || !Array.isArray(artifact.parts)) continue;
      const artifactText = artifact.parts
        .filter((p) => p && p.kind === "text" && typeof p.text === "string")
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join("\n");
      if (artifactText) return artifactText;
    }
  }

  return null;
}

async function callA2A(method, params, options = {}) {
  // Create timeout controller for this request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), A2A_TIMEOUT_MS);

  console.log("[A2A] request", {
    endpoint: A2A_ENDPOINT(),
    method,
    hasParams: Boolean(params),
    timeoutMs: A2A_TIMEOUT_MS,
  });

  let lastError;

  // Retry loop with exponential backoff
  for (let retry = 0; retry < MAX_RETRIES; retry += 1) {
    try {
      const res = await fetch(A2A_ENDPOINT(), {
        method: "POST",
        headers: {
          Authorization: `ApiKey ${API_KEY}`,
          "Content-Type": "application/json",
          "kbn-xsrf": "true",
        },
        signal: controller.signal,
        body: JSON.stringify(buildJsonRpc(method, params)),
      });

      // Clear timeout on success
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      console.log("[A2A] response", {
        ok: res.ok,
        status: res.status,
        hasResult: Boolean(data?.result),
        hasError: Boolean(data?.error),
      });

      // Handle non-OK responses
      if (!res.ok) {
        const statusCode = res.status;
        const isRetryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode);

        if (isRetryable && retry < MAX_RETRIES - 1) {
          const delayMs = RETRY_DELAYS[retry - 1] || Math.min(6000, Math.pow(2, retry) * 1000);
          console.log(`[A2A] transient error ${statusCode}, retrying in ${delayMs}ms`);
          await new Promise(r => setTimeout(r, delayMs));
          continue; // Retry this attempt
        }

        const message = data?.error?.message || res.statusText;
        const details = data?.error || { statusCode };
        const error = new Error(message);
        error.details = details;
        throw error;
      }

      // Handle A2A SDK errors
      if (data.error) {
        const errorCode = data.error.code || "";
        const isRetryableError = !errorCode.includes("VALIDATION") &&
                                  !errorCode.includes("NOT_FOUND") &&
                                  retry < MAX_RETRIES - 1;

        if (isRetryableError) {
          const delayMs = RETRY_DELAYS[retry - 1] || Math.min(6000, Math.pow(2, retry) * 1000);
          console.log(`[A2A] retryable error: ${data.error.message}, retrying`);
          await new Promise(r => setTimeout(r, delayMs));
          continue; // Retry this attempt
        }

        const error = new Error(data.error.message || "A2A error");
        error.details = data.error;
        throw error;
      }

      return data.result || data;

    } catch (err) {
      lastError = err;
      console.log(`[A2A] request failed (attempt ${retry + 1}/${MAX_RETRIES}):`, err.message);

      // Don't retry on abort errors or non-retryable status codes
      if (err.name === "AbortError" || [400, 401, 403, 404].includes(err.details?.statusCode)) {
        throw err;
      }

      // Retry on other transient errors
      if (retry < MAX_RETRIES - 1) {
        const delayMs = RETRY_DELAYS[retry] || Math.min(6000, Math.pow(2, retry + 1) * 1000);
        console.log(`[A2A] waiting ${delayMs}ms before retry`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  // All retries exhausted - throw the last error
  throw lastError || new Error("A2A request failed after all retries");
}

/**
 * Stream response from A2A agent directly to the client
 * Uses readable streams for real-time text delivery
 */
async function callA2ASTreaming(method, params) {
  console.log("[A2A] streaming request", { method });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), A2A_TIMEOUT_MS);

  try {
    const res = await fetch(A2A_ENDPOINT(), {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${API_KEY}`,
        "Content-Type": "application/json",
        "kbn-xsrf": "true",
        Accept: "text/event-stream", // Request SSE stream
      },
      signal: controller.signal,
      body: JSON.stringify(buildJsonRPC(method, params)),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }

    // Read chunks as they arrive and forward immediately
    console.log("[A2A] streaming response started");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = "";
    let firstChunk = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);

      // Parse the chunk - handle both SSE format and raw JSON
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.trim() || !line.startsWith("data:")) continue;

        try {
          const payloadStr = line.slice(5).trim(); // Remove "data:" prefix
          const payload = JSON.parse(payloadStr);

          // Extract text from response - check message, artifact, or status fields
          let text = "";

          if (payload.message) {
            text = extractTextFromMessage(payload.message) || "";
          } else if (payload.artifact && Array.isArray(payload.artifact.parts)) {
            text = payload.artifact.parts
              .filter((p) => p && p.kind === "text" && typeof p.text === "string")
              .map((p) => p.text.trim())
              .filter(Boolean)
              .join("\n");
          } else if (payload.status?.message) {
            text = extractTextFromMessage(payload.status.message) || "";
          }

          if (text) {
            accumulatedText += text;
            firstChunk ??= text;

            // Log chunk for debugging
            console.log(`[A2A] streamed chunk: ${text.length} bytes`);
          }
        } catch (e) {
          // Skip invalid JSON chunks
          continue;
        }
      }
    }

    await reader.cancel();
    console.log(`[A2A] streaming completed, total: ${accumulatedText.length} bytes`);

    return { type: "stream", text: accumulatedText, chunks: firstChunk };

  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("A2A streaming timed out");
    }
    throw err;
  }
}

async function pollTask(taskId, options = {}) {
  // Configuration for polling
  const baseInterval = Number(POLL_INTERVAL_MS) || 1000;
  const maxAttempts = Number(MAX_POLL_ATTEMPTS) || 20;
  const maxDelay = Number(options.maxDelay) || 30000; // Cap at 30 seconds

  let lastTask = null;
  let attempt = 0;

  console.log("[A2A] starting polling for task", { taskId, maxAttempts, baseInterval: `${baseInterval}ms` });

  while (attempt < maxAttempts) {
    attempt += 1;
    console.log(`[A2A] polling task ${taskId} (attempt ${attempt}/${maxAttempts})`);

    const result = await callA2A("tasks/get", { id: taskId });
    lastTask = result?.task || result;

    const state = lastTask?.status?.state;
    if (state) {
      console.log(`[A2A] task ${taskId} status is "${state}"`);
    }

    // Task completed - return immediately
    if (state && TERMINAL_STATES.has(state)) {
      return lastTask;
    }

    // Task failed or canceled - return what we have
    if (state && ["failed", "canceled"].includes(state)) {
      console.log(`[A2A] task ${taskId} completed with terminal state: ${state}`);
      return lastTask;
    }

    // Calculate next delay with exponential backoff + jitter
    if (attempt < maxAttempts) {
      const baseDelay = baseInterval * Math.pow(1.5, attempt); // 1.5x growth instead of 2x for faster recovery
      const randomJitter = Math.random() * baseDelay * 0.2; // ±20% jitter to avoid thundering herd
      const nextDelay = Math.min(baseDelay + randomJitter, maxDelay);

      console.log(`[A2A] task not complete, waiting ${nextDelay.toFixed(0)}ms before next poll`);
      await new Promise(r => setTimeout(r, nextDelay));
    }
  }

  // Exceeded max attempts without completion
  const timeoutError = new Error(`Task timed out after ${maxAttempts} attempts (${(baseInterval * maxAttempts).toFixed(0)}ms total)`);
  timeoutError.code = "TASK_TIMEOUT";
  timeoutError.taskId = taskId;
  throw timeoutError;
}

app.post("/api/chat", async (req, res) => {
  try {
    console.log("[API] /api/chat request format", {
      keys: Object.keys(req.body || {}),
      messageType: typeof req.body?.message,
      messageLength: typeof req.body?.message === "string" ? req.body.message.length : null,
      historyIsArray: Array.isArray(req.body?.history),
      historyCount: Array.isArray(req.body?.history) ? req.body.history.length : 0,
      messagesIsArray: Array.isArray(req.body?.messages),
      messagesCount: Array.isArray(req.body?.messages) ? req.body.messages.length : 0,
    });

    const { message, history, messages, streamMode = false } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }

    const normalizedHistory = normalizeHistory(history || messages);

    console.log("[API] /api/chat message received", {
      length: message.length,
      historyCount: normalizedHistory.length,
      streaming: streamMode,
    });

    // STREAMING MODE: Respond with SSE directly to client
    if (streamMode) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      console.log("[API] streaming response started to client");

      const startTime = Date.now();
      let streamedText = "";

      try {
        const streamResult = await callA2ASTreaming(A2A_METHOD, messageSendParams(message, normalizedHistory));

        if (streamResult.type === "stream") {
          // Forward streamed content to client in real-time chunks
          let chunkIndex = 0;
          const sendChunk = (text) => {
            chunkIndex += 1;
            console.log(`[API] streaming chunk ${chunkIndex}: ${text.length} bytes`);
            res.write(`data: ${JSON.stringify({ type: "stream", delta: text })}\n\n`);
          };

          // For now, forward complete stream (A2A may not support partial SSE)
          streamedText = streamResult.text;

          if (streamResult.chunks) {
            sendChunk(streamResult.chunks);
          }

          console.log(`[API] streaming completed in ${Date.now() - startTime}ms`);
        }

        // Send completion signal
        res.write("data: [DONE]\n\n");

      } catch (err) {
        console.error("[API] streaming error:", err.message);
        res.write(`data: {"error":"${err.message}"}\n\n`);
      } finally {
        res.end();
      }

      return; // Exit after streaming response
    }

    // TRADITIONAL MODE: Poll for task completion (existing behavior)
    const result = await callA2A(A2A_METHOD, messageSendParams(message, normalizedHistory));

    if (result?.message) {
      const text = extractTextFromMessage(result.message) || "";
      console.log("[API] direct message response", { length: text.length });
      return res.json({ text, raw: result });
    }

    const task = result?.task || result;
    if (task?.kind === "message" && Array.isArray(task?.parts)) {
      const text = extractTextFromMessage(task) || "";
      console.log("[API] message payload response", { length: text.length });
      return res.json({ text, raw: result });
    }

    if (task?.id) {
      console.log("[API] task response received", { taskId: task.id });
      const finalTask = TERMINAL_STATES.has(task?.status?.state)
        ? task
        : await pollTask(task.id);
      const text = extractTextFromTask(finalTask) || "";
      console.log("[API] task completed", { taskId: task.id, length: text.length });
      return res.json({ text, raw: finalTask });
    }

    const text = extractTextFromTask(task) || "";
    console.log("[API] fallback response", { length: text.length });
    return res.json({ text, raw: result });
  } catch (err) {
    console.error(err);
    const details = err.details || null;
    return res.status(500).json({ error: err.message || "Server error", details });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(Number(PORT), () => {
  console.log(`Backend listening on port ${PORT}`);
});
