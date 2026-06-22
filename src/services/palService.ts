import path from "path";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { env } from "../config/env";
import { IChatMessage } from "../models/ChatSession";

type PalRole = "student" | "parent" | "teacher";

// Role-aware system prompts so PAL adapts its tone per dashboard view.
const SYSTEM_PROMPTS: Record<PalRole, string> = {
  student:
    "You are PAL, a friendly, encouraging study buddy for a student on EduLearn. " +
    "Explain concepts simply, give step-by-step help, and motivate without giving direct answers to graded work.",
  parent:
    "You are PAL, an assistant for a parent on EduLearn. " +
    "Summarize their child's progress, suggest ways to support learning at home, and answer questions clearly and reassuringly.",
  teacher:
    "You are PAL, an assistant for a teacher on EduLearn. " +
    "Help with lesson planning, class insights, and student performance analysis. Be concise and professional.",
};

// Disable all safety filters so PAL never silently blocks an academic answer.
const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

// Keep replies snappy and bounded: cap how many past turns we replay, how long
// we wait on Vertex, and how many times we retry transient failures.
const MAX_HISTORY_TURNS = 20; // last N messages sent as context (keeps it fast)
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES

// Lazily build a single Vertex client (the SDK reads the service-account JSON
// referenced by GOOGLE_APPLICATION_CREDENTIALS, resolved to an absolute path).
let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
      env.googleCredentialsFile
    );
    client = new GoogleGenAI({
      vertexai: true,
      project: env.vertexProject,
      location: env.vertexLocation,
    });
  }
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Transient errors worth retrying: rate limits, overload, gateway/timeouts.
function isRetryable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /\b(429|500|502|503|504)\b|overload|unavailable|deadline|timeout|ECONNRESET|ETIMEDOUT/i.test(
    msg
  );
}

// Race a promise against a timeout so a hung call can't block the request.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Vertex request timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// Calls Vertex AI (Gemini). Falls back to a stub if no credentials are set.
// `context` is a summary of the user's real EduLearn data (see palContext.ts);
// when present it's appended to the role prompt so PAL grounds answers in it.
export async function generatePalReply(
  palRole: PalRole,
  history: IChatMessage[],
  message: string,
  context = ""
): Promise<string> {
  const systemInstruction = context
    ? `${SYSTEM_PROMPTS[palRole]}\n\n${context}`
    : SYSTEM_PROMPTS[palRole];

  if (!env.vertexConfigured) {
    // Stub reply so the endpoint works end-to-end without credentials in dev.
    return `(${palRole} PAL — stub) You said: "${message}". Set GOOGLE_APPLICATION_CREDENTIALS to enable real AI replies.`;
  }

  // Only replay the most recent turns so long sessions stay responsive.
  const recent = history.slice(-MAX_HISTORY_TURNS);

  // Gemini uses role "model" for assistant turns; map our stored history to it.
  const contents = [
    ...recent.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await withTimeout(
        getClient().models.generateContent({
          model: env.vertexModel,
          contents,
          config: {
            systemInstruction,
            temperature: 0.7,
            topP: 0.95,
            maxOutputTokens: 2048,
            safetySettings: SAFETY_SETTINGS,
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const text = response.text?.trim();
      if (text) return text;

      // Empty body usually means a safety/recitation block — surface it plainly.
      const blocked = response.candidates?.[0]?.finishReason;
      throw new Error(`Gemini returned no text (finishReason: ${blocked ?? "unknown"})`);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await sleep(400 * (attempt + 1)); // 400ms, 800ms backoff
        continue;
      }
      break;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
