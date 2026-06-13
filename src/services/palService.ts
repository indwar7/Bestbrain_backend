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

interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

// Calls Groq's OpenAI-compatible chat API. Falls back to a stub if no key is set.
export async function generatePalReply(
  palRole: PalRole,
  history: IChatMessage[],
  message: string
): Promise<string> {
  const messages: ChatTurn[] = [
    { role: "system", content: SYSTEM_PROMPTS[palRole] },
    ...history.map((m) => ({ role: m.role, content: m.content } as ChatTurn)),
    { role: "user", content: message },
  ];

  if (!env.groqApiKey) {
    // Stub reply so the endpoint works end-to-end without a key during dev.
    return `(${palRole} PAL — stub) You said: "${message}". Set GROQ_API_KEY to enable real AI replies.`;
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content?.trim() ?? "(no reply)";
}
