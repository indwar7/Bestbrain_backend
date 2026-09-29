import path from "path";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { env } from "../config/env";
import { IChatMessage } from "../models/ChatSession";

type PalRole = "student" | "parent" | "teacher";

// Role-aware system prompts so PAL adapts its tone per dashboard view.
const SYSTEM_PROMPTS: Record<PalRole, string> = {
  student:
    "You are PAL, a friendly, encouraging study buddy for a student on BestBrain. " +
    "Explain concepts simply, give step-by-step help, and motivate without giving direct answers to graded work.",
  parent:
    "You are PAL, an assistant for a parent on BestBrain. " +
    "Summarize their child's progress, suggest ways to support learning at home, and answer questions clearly and reassuringly.",
  teacher:
    "You are PAL, an assistant for a teacher on BestBrain. " +
    "Help with lesson planning, class insights, and student performance analysis. Be concise and professional.",
};

// Extra instructions layered on top of the role prompt when the reply will be
// SPOKEN aloud (the live doubt session). TTS reads the text verbatim, so
// markdown, symbols and long lecture-style answers all degrade the experience.
const VOICE_STYLE =
  "\n\nYou are currently on a LIVE VOICE CALL (a live doubt session) and your reply " +
  "will be read aloud by text-to-speech. Follow these rules strictly:\n" +
  "- Keep it short and conversational: 2-4 sentences unless the student asks for more.\n" +
  "- Plain speakable text only: no markdown, no asterisks, no bullet points, no " +
  "headings, no LaTeX, no code blocks, no emoji.\n" +
  "- Say maths the way it is spoken: 'x squared plus 2 x minus 7', 'three by four', " +
  "not symbols like x^2 or 3/4.\n" +
  "- Answer the doubt directly first, then optionally one short check question.\n" +
  "- For a big topic, give the core idea and ask if they want you to go deeper.\n" +
  "- Reply in the language the student spoke (English, Hindi or Hinglish).\n" +
  "- Be warm and encouraging, like a friendly teacher on a call.";

// Voice replies are meant to be a few spoken sentences, a tighter cap keeps
// both latency and TTS duration down.
const VOICE_MAX_OUTPUT_TOKENS = 512;

function buildSystemInstruction(
  palRole: PalRole,
  context: string,
  voice: boolean
): string {
  const base = voice ? SYSTEM_PROMPTS[palRole] + VOICE_STYLE : SYSTEM_PROMPTS[palRole];
  return context ? `${base}\n\n${context}` : base;
}

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

// Reject prompts longer than this so a single request can't blow up token cost.
export const MAX_MESSAGE_LENGTH = 4000;

// Lazily build a single Vertex client. Credentials come from EITHER an inline
// JSON env var (preferred for hosting, no filesystem needed) OR a file path
// (convenient for local dev). See env.ts for the two supported variables.
// One client per location: chat runs in env.vertexLocation, but a call that
// retrieves from a RAG corpus has to run in the corpus's own region.
const clients = new Map<string, GoogleGenAI>();
function getClient(location: string = env.vertexLocation): GoogleGenAI {
  let client = clients.get(location);
  if (!client) {
    const base = {
      vertexai: true as const,
      project: env.vertexProject,
      location,
    };

    if (env.googleCredentialsJson) {
      // Parse the service-account JSON straight from the env var.
      //
      // Guarded because the usual way this goes wrong is a multi-line paste:
      // dotenv stops the value at the first newline, so the JSON arrives
      // truncated and this throws a bare "Unexpected end of JSON input" ,
      // which matches none of isConfigFailure()'s patterns, so the student saw
      // "PAL is unavailable right now" (a transient-sounding message) for a
      // permanent setup mistake. Re-thrown with wording that pattern matches
      // and that names the actual fix.
      let credentials: Record<string, unknown>;
      try {
        credentials = JSON.parse(env.googleCredentialsJson);
      } catch {
        throw new Error(
          "could not load the default credentials: GOOGLE_CREDENTIALS_JSON is not valid JSON. " +
            "Paste the service-account file as a SINGLE line, keeping the \\n escapes inside private_key."
        );
      }
      client = new GoogleGenAI({
        ...base,
        googleAuthOptions: { credentials },
      });
    } else {
      // Fall back to the file path the Google auth library reads from this env var.
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
        env.googleCredentialsFile
      );
      client = new GoogleGenAI(base);
    }
    clients.set(location, client);
  }
  return client;
}

// How many textbook chunks RAG Engine hands the model per question.
const RAG_TOP_K = 5;

// Book-only mode: for a class with an uploaded textbook, PAL must not fall
// back on general knowledge. Only the retrieved passages (and the student's
// own progress data above) are allowed sources.
const RAG_STYLE =
  "\n\nSTRICT TEXTBOOK MODE. You can retrieve passages from this student's uploaded " +
  "NCERT textbook, and those passages are your ONLY source for any academic answer.\n" +
  "- Answer only with facts, definitions, examples and activities found in the retrieved " +
  "passages. Use the book's own terms, and name the chapter the answer comes from.\n" +
  "- Do NOT add facts, numbers, examples or explanations from general knowledge, even if " +
  "you are sure they are correct.\n" +
  "- If the passages don't answer the question (including questions from another subject " +
  "or class), say plainly that it isn't covered in their textbook and suggest a related " +
  "topic from the book they can ask about instead. Do not answer it anyway.\n" +
  "- You may still greet the student, encourage them, and answer questions about their own " +
  "BestBrain progress using the progress data given above.";

// Lower than normal chat: in book-only mode PAL should restate the textbook,
// not improvise around it.
const RAG_TEMPERATURE = 0.2;

// Retrieval setup for a student's class, or null when that class has no corpus
// (see PAL_RAG_CORPORA in env.ts). The location is read off the corpus name,
// projects/<p>/locations/<loc>/ragCorpora/<id>.
function ragFor(className: string) {
  const ragCorpus = className ? env.palRagCorpora[className] : undefined;
  if (!ragCorpus) return null;
  const location = /\/locations\/([^/]+)\//.exec(ragCorpus)?.[1] ?? env.vertexLocation;
  return {
    location,
    tools: [
      {
        retrieval: {
          vertexRagStore: {
            ragResources: [{ ragCorpus }],
            ragRetrievalConfig: { topK: RAG_TOP_K },
          },
        },
      },
    ],
  };
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
// `context` is a summary of the user's real BestBrain data (see palContext.ts);
// when present it's appended to the role prompt so PAL grounds answers in it.
export async function generatePalReply(
  palRole: PalRole,
  history: IChatMessage[],
  message: string,
  context = "",
  voice = false,
  className = "",
  // A chat reply fits in 2048 tokens; a whole structured study sheet does not,
  // and a cut-off reply is unparseable JSON. Callers producing long documents
  // raise this.
  maxOutputTokens = 2048
): Promise<string> {
  const rag = ragFor(className);
  const systemInstruction = (rag: unknown) =>
    buildSystemInstruction(palRole, context, voice) + (rag ? RAG_STYLE : "");

  if (!env.vertexConfigured) {
    // Stub reply so the endpoint works end-to-end without credentials in dev.
    return `(${palRole} PAL, stub) You said: "${message}". Set GOOGLE_APPLICATION_CREDENTIALS to enable real AI replies.`;
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
        getClient(rag?.location).models.generateContent({
          model: env.vertexModel,
          contents,
          config: {
            systemInstruction: systemInstruction(rag),
            tools: rag?.tools,
            temperature: rag ? RAG_TEMPERATURE : 0.7,
            topP: 0.95,
            maxOutputTokens: voice ? VOICE_MAX_OUTPUT_TOKENS : maxOutputTokens,
            safetySettings: SAFETY_SETTINGS,
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const text = response.text?.trim();
      if (text) return text;

      // Empty body usually means a safety/recitation block, surface it plainly.
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

// Streaming variant: yields text chunks as Gemini produces them. The caller is
// responsible for accumulating the full reply (e.g. to persist it). No retry
// here, once bytes start flowing to the client we can't cleanly restart.
export async function* streamPalReply(
  palRole: PalRole,
  history: IChatMessage[],
  message: string,
  context = "",
  voice = false,
  className = ""
): AsyncGenerator<string, void, unknown> {
  const base = buildSystemInstruction(palRole, context, voice);

  if (!env.vertexConfigured) {
    yield `(${palRole} PAL, stub) You said: "${message}". Set GOOGLE_APPLICATION_CREDENTIALS to enable real AI replies.`;
    return;
  }

  const recent = history.slice(-MAX_HISTORY_TURNS);
  const contents = [
    ...recent.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const open = (rag: ReturnType<typeof ragFor>) =>
    getClient(rag?.location).models.generateContentStream({
      model: env.vertexModel,
      contents,
      config: {
        systemInstruction: base + (rag ? RAG_STYLE : ""),
        tools: rag?.tools,
        temperature: rag ? RAG_TEMPERATURE : 0.7,
        topP: 0.95,
        maxOutputTokens: voice ? VOICE_MAX_OUTPUT_TOKENS : 2048,
        safetySettings: SAFETY_SETTINGS,
      },
    });

  // No fallback to a retrieval-free call: for a book-only class that would
  // be exactly the general-knowledge answer book-only mode forbids, so a
  // broken corpus surfaces as "PAL is unavailable" instead.
  const stream = await open(ragFor(className));

  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}
