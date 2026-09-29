/**
 * Writes a chapter question bank straight from the textbook PDFs, so the
 * Question Bank, Quiz, Mock Test and Challenge only ask what the book teaches.
 *
 * For every chapter PDF, Gemini reads the PDF itself and writes N multiple
 * choice questions whose answer and explanation come from that chapter. A
 * second pass re-reads the chapter and drops any question whose answer the
 * text doesn't support, so a general-knowledge question can't slip through.
 *
 * Files are matched to chapters by order: "Ch01 ...pdf" is the first slug.
 *
 * Run with:
 *   npm run gen:book-questions -- <pdf folder> <out.json> <slug1,slug2,...> [perChapter]
 * Output is the { [chapterSlug]: Seed[] } shape seedClass7Science.ts reads.
 */
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../config/env";

const [folder, outFile, slugArg, perArg] = process.argv.slice(2);
if (!folder || !outFile || !slugArg) {
  console.error("usage: npm run gen:book-questions -- <pdf folder> <out.json> <slug1,slug2,...> [perChapter]");
  process.exit(1);
}
const SLUGS = slugArg.split(",").map((s) => s.trim());
const PER_CHAPTER = Number(perArg ?? 15);
// Generation is a one-off offline job, so use the stronger model.
const MODEL = process.env.VERTEX_QGEN_MODEL ?? "gemini-2.5-pro";

type Seed = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

const ai = new GoogleGenAI({
  vertexai: true,
  project: env.vertexProject,
  location: env.vertexLocation,
  googleAuthOptions: env.googleCredentialsJson
    ? { credentials: JSON.parse(env.googleCredentialsJson) }
    : { keyFile: path.resolve(env.googleCredentialsFile) },
});

const QUESTIONS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      correctIndex: { type: Type.INTEGER },
      explanation: { type: Type.STRING },
      difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
    },
    required: ["text", "options", "correctIndex", "explanation", "difficulty"],
  },
};

const VERDICT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: { type: Type.INTEGER },
      supported: { type: Type.BOOLEAN },
      reason: { type: Type.STRING },
    },
    required: ["index", "supported"],
  },
};

function pdfPart(file: string) {
  return { inlineData: { mimeType: "application/pdf", data: fs.readFileSync(file).toString("base64") } };
}

async function askJson<T>(file: string, prompt: string, schema: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [pdfPart(file), { text: prompt }] }],
        config: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema },
      });
      return JSON.parse(res.text ?? "");
    } catch (err) {
      if (attempt >= 2) throw err;
      console.log(`  retry after: ${String((err as Error).message).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
}

function valid(q: Seed): boolean {
  return (
    typeof q.text === "string" && q.text.trim().length > 0 &&
    Array.isArray(q.options) && q.options.length === 4 &&
    new Set(q.options.map((o) => o.trim().toLowerCase())).size === 4 &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4 &&
    typeof q.explanation === "string" && q.explanation.trim().length > 0
  );
}

// Models put the right answer in the same slot far too often (in the first
// run, C for over half the bank), which a student learns to guess. Shuffle
// the options with a seed from the question text, so a re-run gives the same
// order and the seeder's (chapter, text) identity still holds.
export function shuffleOptions(q: Seed): Seed {
  let h = 2166136261;
  for (const ch of q.text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

async function chapterQuestions(file: string): Promise<Seed[]> {
  // Ask for a few extra: the verify pass and the shape check both drop some.
  const want = PER_CHAPTER + 5;
  const drafted = await askJson<Seed[]>(
    file,
    `This PDF is one chapter of a Class 7 NCERT Science textbook. Write ${want} multiple-choice ` +
      `questions for Class 7 students, based ONLY on this chapter.\n` +
      `Rules:\n` +
      `- Every question, correct answer and explanation must come directly from the chapter text, ` +
      `its activities, figures, tables or "Let us enhance our learning" exercises. No outside facts.\n` +
      `- Exactly 4 options, one clearly correct; the wrong options should be plausible but clearly ` +
      `wrong according to the chapter.\n` +
      `- Test the science the chapter teaches (concepts, definitions, observations, activities and ` +
      `their results, reasons, examples). Never ask about the book itself: its layout, page numbers, ` +
      `illustrations, characters' names, or what "the introduction" says.\n` +
      `- The explanation (1-2 sentences) teaches why the answer is right, stated directly as a fact ` +
      `using the book's terms. Never write "the text says", "according to the chapter" or quote the book.\n` +
      `- Cover the whole chapter, not just the first pages. Mix difficulty: about 5 easy, 7 medium, 3 hard per 15.\n` +
      `- Don't refer to "the chapter", "the figure" or page numbers in the question; it must stand alone.\n` +
      `- Simple English suitable for a 12-year-old.`,
    QUESTIONS_SCHEMA
  );
  const shaped = drafted.filter(valid);

  const verdicts = await askJson<{ index: number; supported: boolean; reason?: string }[]>(
    file,
    `This PDF is one chapter of a Class 7 NCERT Science textbook. Below are multiple-choice ` +
      `questions with their marked answers. For EACH one, decide whether the chapter text itself ` +
      `states or directly supports the marked answer AND the explanation. Mark supported=false if ` +
      `the answer needs knowledge not in the chapter, if the marked answer is wrong, or if another ` +
      `option is also correct.\n\n` +
      JSON.stringify(shaped.map((q, index) => ({ index, text: q.text, options: q.options, answer: q.options[q.correctIndex], explanation: q.explanation }))),
    VERDICT_SCHEMA
  );
  const ok = new Set(verdicts.filter((v) => v.supported).map((v) => v.index));
  for (const v of verdicts.filter((v) => !v.supported)) {
    console.log(`  dropped: ${shaped[v.index]?.text.slice(0, 70)} (${v.reason ?? "unsupported"})`);
  }
  const kept = shaped.filter((_, i) => ok.has(i));
  if (kept.length < PER_CHAPTER) console.log(`  WARNING only ${kept.length} verified questions`);
  return kept.slice(0, PER_CHAPTER).map(shuffleOptions);
}

async function main() {
  const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (files.length !== SLUGS.length) {
    throw new Error(`${files.length} PDFs but ${SLUGS.length} slugs, they must match one to one`);
  }

  // Resume: keep chapters already written to the output file.
  const bank: Record<string, Seed[]> = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  const save = () => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(bank, null, 2) + "\n");
  };
  // A few chapters at a time: each is a couple of slow model calls.
  const todo = files.map((f, i) => ({ file: f, slug: SLUGS[i] }));
  const worker = async () => {
    for (let job = todo.shift(); job; job = todo.shift()) {
      if ((bank[job.slug]?.length ?? 0) >= PER_CHAPTER) {
        console.log(`skip ${job.slug} (already has ${bank[job.slug].length})`);
        continue;
      }
      const qs = await chapterQuestions(path.join(folder, job.file));
      bank[job.slug] = qs;
      console.log(`${job.slug} <- ${job.file}: ${qs.length} questions`);
      save();
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  // Keep the book's chapter order in the file.
  for (const slug of SLUGS) {
    const qs = bank[slug];
    delete bank[slug];
    if (qs) bank[slug] = qs;
  }
  save();
  console.log(`\nWrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
