import { generatePalReply } from "./palService";

/**
 * Structured study material for one topic.
 *
 * The shape is fixed and the client renders it — the model is never asked for
 * HTML or PDF bytes. Free-form markup from a model is the one thing you cannot
 * safely drop into a page, and a fixed shape also means a missing or malformed
 * field degrades one section instead of the whole document.
 */
export interface StudySection {
  heading: string;
  /** Prose paragraphs. */
  body?: string[];
  /** Bulleted lines — definitions, key points, questions. */
  points?: string[];
}

export interface StudyDoc {
  topic: string;
  className: string;
  subject: string;
  sections: StudySection[];
  /** true when a model wrote it; false when the outline below stood in. */
  generated: boolean;
}

/**
 * Topics we will write about. The feature is a science study aid, so a request
 * for something else should say so rather than quietly produce a page of
 * plausible-sounding nonsense under a school's banner.
 *
 * The list is deliberately generous — it is a guard against obvious misuse,
 * not a syllabus checker. A real chapter name that is not on it still passes
 * as long as it reads like a topic rather than a sentence.
 */
const SCIENCE_HINTS = [
  "photosynth", "respiration", "digest", "circulat", "excret", "reproduc",
  "cell", "tissue", "organ", "microb", "bacteria", "virus", "plant", "animal",
  "food", "nutrition", "fibre", "fabric", "material", "metal", "non-metal",
  "acid", "base", "salt", "element", "compound", "mixture", "separation",
  "atom", "molecule", "periodic", "chemical", "reaction", "combustion",
  "motion", "force", "gravity", "friction", "pressure", "work", "energy",
  "power", "sound", "light", "reflect", "refract", "lens", "mirror", "electric",
  "current", "circuit", "magnet", "heat", "temperature", "wave",
  "solar", "planet", "star", "space", "earth", "soil", "water", "air", "wind",
  "storm", "cyclone", "weather", "climate", "environment", "pollution",
  "ecosystem", "forest", "conservation", "natural resource", "crop",
  "matter", "state of matter", "physic", "chemist", "biolog", "science",
  "gene", "dna", "evolution", "human", "body", "skeleton", "muscle", "brain",
  "heart", "lung", "kidney", "eye", "ear", "blood", "nerve",
];

/** Rejects sentences, questions and obvious junk; accepts topic-shaped input. */
export function checkTopic(raw: string): { ok: boolean; reason?: string } {
  const topic = raw.trim();
  if (topic.length < 3) return { ok: false, reason: "Topic is too short." };
  if (topic.length > 120) return { ok: false, reason: "Topic is too long — try a chapter name." };

  const words = topic.split(/\s+/);
  if (words.length > 12) {
    return { ok: false, reason: "Enter a topic, not a full sentence." };
  }
  if (!/[a-zA-Zऀ-ॿ]/.test(topic)) {
    return { ok: false, reason: "Enter a topic in words." };
  }

  const low = topic.toLowerCase();
  const looksScience = SCIENCE_HINTS.some((h) => low.includes(h));
  /* A two-or-three word phrase that is not obviously off-topic is allowed
     through: chapter names are endless and an allow-list cannot hold them
     all. Anything longer has to actually look like science. */
  if (!looksScience && words.length > 3) {
    return {
      ok: false,
      reason: "This does not look like a science topic. Try something like 'Photosynthesis'.",
    };
  }
  return { ok: true };
}

const SECTION_PLAN = [
  "Introduction",
  "Basic Concepts",
  "Detailed Explanation",
  "Important Definitions",
  "Key Points",
  "Examples",
  "Applications",
  "Quick Revision",
  "Important Questions",
  "Summary",
];

function prompt(topic: string, className: string): string {
  return [
    `Write study material on "${topic}" for a ${className} student following the NCERT science curriculum.`,
    "",
    "Return ONLY a JSON object, no markdown fence, in exactly this shape:",
    '{"sections":[{"heading":"...","body":["para",...],"points":["line",...]}]}',
    "",
    `Use these headings, in this order: ${SECTION_PLAN.join(", ")}.`,
    "Use `body` for prose sections and `points` for lists.",
    "Rules:",
    "- Write it yourself in plain language a school student understands. Explain the",
    "  concepts as the NCERT curriculum covers them; do not copy any book's text.",
    "- Definitions, Key Points, Quick Revision and Important Questions must use `points`.",
    "- Important Questions: 5 questions a student could be asked in an exam.",
    "- Be accurate. If something is outside the school syllabus, leave it out.",
  ].join("\n");
}

/** Salvages the JSON object from a reply that may carry a fence or a preamble. */
function parseSections(raw: string): StudySection[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const sections = (parsed as { sections?: unknown })?.sections;
  if (!Array.isArray(sections)) return null;

  const clean: StudySection[] = [];
  for (const s of sections) {
    const heading = typeof (s as StudySection)?.heading === "string"
      ? (s as StudySection).heading.trim()
      : "";
    if (!heading) continue;
    const body = Array.isArray((s as StudySection).body)
      ? (s as StudySection).body!.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : undefined;
    const points = Array.isArray((s as StudySection).points)
      ? (s as StudySection).points!.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : undefined;
    if (!body?.length && !points?.length) continue;
    clean.push({ heading, body, points });
  }
  return clean.length >= 3 ? clean : null;
}

/**
 * The stand-in. It is a study *scaffold*, not invented facts: without a model
 * we cannot write the explanation, and inventing one under a school's name is
 * worse than handing the student a structure to fill in. Every screen that
 * shows this is told the difference via `generated: false`.
 */
function outline(topic: string, className: string): StudySection[] {
  return [
    {
      heading: "Introduction",
      body: [
        `This study sheet covers ${topic} for ${className}, following the NCERT science curriculum.`,
        "The explanation could not be written automatically right now, so the sheet below is a structure to work through with your textbook or with PAL.",
      ],
    },
    {
      heading: "Basic Concepts",
      points: [
        `What ${topic} means, in one sentence of your own.`,
        "The terms your chapter introduces alongside it.",
        "Where this sits in the chapter — what comes before and after.",
      ],
    },
    {
      heading: "Detailed Explanation",
      points: [
        "The main idea, step by step.",
        "The process or rule involved, in order.",
        "A diagram, if your chapter has one — copy it and label it.",
      ],
    },
    {
      heading: "Important Definitions",
      points: ["Write each bold term from the chapter with its definition."],
    },
    {
      heading: "Key Points",
      points: ["List the points your teacher underlined or repeated."],
    },
    {
      heading: "Examples",
      points: ["Two everyday examples.", "One solved example from the chapter."],
    },
    {
      heading: "Applications",
      points: [`Where ${topic} shows up in daily life or in technology.`],
    },
    { heading: "Quick Revision", points: ["Five lines you could revise the night before an exam."] },
    {
      heading: "Important Questions",
      points: [
        `Define ${topic}.`,
        `Explain ${topic} in your own words.`,
        `Give two examples of ${topic}.`,
        `Why is ${topic} important?`,
        `Draw and label a diagram related to ${topic}.`,
      ],
    },
    { heading: "Summary", points: ["Three sentences covering the whole topic."] },
  ];
}

export async function buildStudyDoc(
  topic: string,
  className: string,
  subject = "Science"
): Promise<StudyDoc> {
  let sections: StudySection[] | null = null;

  try {
    const reply = await generatePalReply(
      "student",
      [],
      prompt(topic, className),
      `The student is in ${className}.`
    );
    sections = parseSections(reply);
  } catch {
    sections = null; // model unavailable or refused — the outline stands in
  }

  return {
    topic,
    className,
    subject,
    sections: sections ?? outline(topic, className),
    generated: !!sections,
  };
}
