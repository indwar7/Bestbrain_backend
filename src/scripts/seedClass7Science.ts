/**
 * Seeds the Class 7 Science question bank (40 questions for each of the 12
 * chapters) and one homework assignment per chapter, so every Class 7 Science
 * chapter has a working Quiz, Question Bank and Homework behind it.
 *
 * The questions live in ./data/class7Science.json, keyed by the chapter slug
 * Learn uses (curriculum.js).
 *
 * Idempotent, like seedClass6Science: a question is identified by (className,
 * subject, chapterSlug, text) and homework by (className, subject, title), so
 * re-running only adds what is missing.
 *
 * Run with: npm run seed:class7science
 *
 * --replace: the bank is book-only (generated from the NCERT PDFs by
 * genBookQuestions.ts), so also delete every admin-seeded Class 7 Science
 * question that is NOT in the JSON, and take those questions out of any
 * homework that used them. Teacher-written questions are left alone.
 *   npm run seed:class7science -- --replace
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Question } from "../models/Question";
import { Homework } from "../models/Homework";
import { User } from "../models/User";

const CLASS = "Class 7";
const SUBJECT = "Science";

type Seed = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

const BANK: Record<string, Seed[]> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "class7Science.json"), "utf8")
);

// One assignment per chapter, so the Homework button on every Class 7 Science
// chapter opens real work. The first three titles are the original samples and
// are kept as they were, so an environment that already has them gets the
// other nine added rather than three duplicates.
// Questions answered on paper and uploaded as a PDF or photo, three per chapter.
const WRITTEN: Record<string, string[]> = {
  "electricity-circuits": [
    "Draw a circuit with a cell, a switch and a bulb. Label each part and show the direction of the current.",
    "Explain why a bulb does not glow when the switch is open.",
    "List three conductors and three insulators you can find at home."
  ],
  "metals-nonmetals": [
    "Compare metals and non-metals on any four properties in a table.",
    "Why are cooking pans made of metal but their handles made of plastic or wood?",
    "What is rusting? Write two ways to prevent it."
  ],
  "physical-chemical-changes": [
    "Write two examples each of physical and chemical changes from your kitchen.",
    "Explain why burning a candle shows both a physical and a chemical change.",
    "Describe the lime water test and what it tells us."
  ],
  "adolescence": [
    "List four physical changes that happen during adolescence.",
    "Why is a balanced diet important for adolescents? Suggest a healthy one-day meal plan.",
    "Write three ways to stay safe from harmful substances and online bullying."
  ],
  "heat-transfer": [
    "Explain conduction, convection and radiation with one everyday example each.",
    "Why do we feel a cool breeze near the sea during the day?",
    "Why are dark clothes preferred in winter and light clothes in summer?"
  ],
  "time-and-motion": [
    "Draw a simple pendulum and mark one oscillation. How would you measure its time period?",
    "A bus covers 120 km in 3 hours. Find its speed and show your working.",
    "What is the difference between uniform and non-uniform motion? Give one example of each."
  ],
  "evolving-science": [
    "Describe the steps of the scientific method in your own words.",
    "Give one example of a scientific idea that changed over time.",
    "Plan a small experiment to test whether plants need sunlight to grow."
  ],
  "acidic-basic-neutral": [
    "Name three natural indicators and the colour each shows with an acid and a base.",
    "What is neutralisation? Give two examples from daily life.",
    "Classify lemon juice, soap solution, vinegar, water and baking soda solution as acidic, basic or neutral."
  ],
  "life-processes-animals": [
    "Draw and label the human digestive system.",
    "Explain what happens to food in the mouth, stomach and small intestine.",
    "How do fish and insects breathe? Compare them with humans."
  ],
  "life-processes-plants": [
    "Write the word equation for photosynthesis and explain each part.",
    "Describe an activity to show that a leaf makes starch.",
    "How do water and minerals travel from the roots to the leaves?"
  ],
  "light-shadows": [
    "Classify ten objects around you as transparent, translucent or opaque.",
    "Draw a diagram to show how a shadow is formed.",
    "Describe how a pinhole camera works and why its image is upside down."
  ],
  "earth-moon-sun": [
    "Explain how the rotation of the Earth causes day and night.",
    "Why do we see different phases of the Moon? Draw any four phases.",
    "Explain how a solar eclipse happens with a labelled diagram."
  ]
};

const HOMEWORK = [
  { chapterSlug: "electricity-circuits", title: "Electric circuits, practice set",
    instructions: "Draw the circuit in your notebook before you answer each question." },
  { chapterSlug: "metals-nonmetals", title: "Metals and non-metals, practice set",
    instructions: "Revise the properties of metals and non-metals before you start." },
  { chapterSlug: "physical-chemical-changes", title: "Physical and chemical changes, practice set",
    instructions: "For every change, ask yourself whether a new substance is formed." },
  { chapterSlug: "adolescence", title: "Adolescence, chapter check",
    instructions: "Read the chapter once more before you answer." },
  { chapterSlug: "heat-transfer", title: "Heat transfer, revision",
    instructions: "Think of one example from your kitchen for every question." },
  { chapterSlug: "time-and-motion", title: "Time and motion, practice set",
    instructions: "Keep a pen and paper ready for the speed calculations." },
  { chapterSlug: "evolving-science", title: "The world of science, chapter check",
    instructions: "Think about how a scientist would test each idea." },
  { chapterSlug: "acidic-basic-neutral", title: "Acids, bases and indicators, chapter check",
    instructions: "Revise how each indicator changes colour before you start." },
  { chapterSlug: "life-processes-animals", title: "Life processes in animals, practice set",
    instructions: "Revise the path food takes through the body before you start." },
  { chapterSlug: "life-processes-plants", title: "Life processes in plants, practice set",
    instructions: "Revise what a plant needs for photosynthesis before you start." },
  { chapterSlug: "light-shadows", title: "Light, shadows and reflections, practice set",
    instructions: "Think about how light travels before you answer." },
  { chapterSlug: "earth-moon-sun", title: "Earth, Moon and the Sun, chapter check",
    instructions: "Picture the Earth spinning and moving around the Sun as you answer." },
].map((h) => ({ ...h, dueInDays: 30, take: 8, written: WRITTEN[h.chapterSlug] || [] }));

async function removeStale(): Promise<void> {
  const keep = new Set(
    Object.entries(BANK).flatMap(([slug, seeds]) => seeds.map((q) => `${slug}|${q.text.trim()}`))
  );
  const seeded = await Question.find({ className: CLASS, subject: SUBJECT, createdByRole: "admin" })
    .select("_id chapterSlug text")
    .lean();
  const stale = seeded.filter((q) => !keep.has(`${q.chapterSlug}|${q.text.trim()}`)).map((q) => q._id);
  if (stale.length === 0) {
    console.log("Replace: no stale questions.");
    return;
  }
  const hw = await Homework.updateMany(
    { questionIds: { $in: stale } },
    { $pull: { questionIds: { $in: stale } } }
  );
  await Question.deleteMany({ _id: { $in: stale } });
  console.log(`Replace: removed ${stale.length} non-book questions (${hw.modifiedCount} homework updated).`);

  // Sample homework left with no questions is refilled below from the new bank.
  await Homework.deleteMany({
    className: CLASS,
    subject: SUBJECT,
    title: { $in: HOMEWORK.map((h) => h.title) },
    questionIds: { $size: 0 },
  });
}

async function main() {
  await connectDB();
  if (process.argv.includes("--replace")) await removeStale();

  let added = 0;
  let skipped = 0;
  for (const [chapterSlug, seeds] of Object.entries(BANK)) {
    for (const q of seeds) {
      const exists = await Question.findOne({
        className: CLASS,
        subject: SUBJECT,
        chapterSlug,
        text: q.text,
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      await Question.create({
        className: CLASS,
        subject: SUBJECT,
        chapterSlug,
        ...q,
        // "both": serves the Question Bank and the adaptive Quiz.
        usage: "both",
        createdByRole: "admin",
      });
      added += 1;
    }
  }

  console.log(`Questions: ${added} added, ${skipped} already present.`);
  for (const slug of Object.keys(BANK)) {
    const n = await Question.countDocuments({ className: CLASS, subject: SUBJECT, chapterSlug: slug });
    console.log(`  ${slug.padEnd(26)} ${n}`);
  }

  // Prefer a teacher who teaches Class 7; any teacher will do otherwise.
  const teacher =
    (await User.findOne({ role: "teacher", "teaches.className": CLASS }).select("_id")) ||
    (await User.findOne({ role: "teacher" }).select("_id"));
  if (!teacher) {
    console.log("\nNo teacher account found, skipping the sample homework.");
    await mongoose.disconnect();
    return;
  }

  let hwAdded = 0;
  for (const h of HOMEWORK) {
    const exists = await Homework.findOne({ className: CLASS, subject: SUBJECT, title: h.title });
    if (exists) {
      // Homework created before written questions existed gets them now.
      if (!exists.writtenQuestions || exists.writtenQuestions.length === 0) {
        exists.writtenQuestions = h.written;
        await exists.save();
        console.log(`~ homework: ${h.title} (+${h.written.length} written questions)`);
      }
      continue;
    }

    const qs = await Question.find({ className: CLASS, subject: SUBJECT, chapterSlug: h.chapterSlug })
      .limit(h.take)
      .select("_id");
    if (qs.length === 0) continue;

    await Homework.create({
      className: CLASS,
      subject: SUBJECT,
      chapterSlug: h.chapterSlug,
      title: h.title,
      instructions: h.instructions,
      questionIds: qs.map((q) => q._id),
      writtenQuestions: h.written,
      dueAt: new Date(Date.now() + h.dueInDays * 24 * 60 * 60 * 1000),
      assignedById: teacher._id,
      assignedByRole: "teacher",
      isPublished: true,
    });
    hwAdded += 1;
    console.log(`+ homework: ${h.title} (${qs.length} questions)`);
  }
  console.log(`Homework: ${hwAdded} added.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
