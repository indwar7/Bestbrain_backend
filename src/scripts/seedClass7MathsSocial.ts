/**
 * Seeds the Class 7 Maths and Social Science question banks (60 questions for
 * each chapter) and one homework assignment per chapter, so every chapter of
 * both subjects has a working Quiz, Question Bank, Arena pool and Homework.
 *
 * The questions live in ./data/class7Maths.json and ./data/class7Social.json,
 * keyed by the chapter slug Learn uses (curriculum.js). The homework text
 * (title, instructions, three written questions) is in ./data/class7Homework.json.
 *
 * Idempotent, like seedClass7Science: a question is identified by (className,
 * subject, chapterSlug, text) and homework by (className, subject, title), so
 * re-running only adds what is missing.
 *
 * Run with: npm run seed:class7maths-social
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Question } from "../models/Question";
import { Homework } from "../models/Homework";
import { User } from "../models/User";

const CLASS = "Class 7";

type Seed = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

type HomeworkText = { title: string; instructions: string; written: string[] };

const read = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "data", file), "utf8")) as T;

// The API stores the display name ("Social Science"), Learn uses a short key.
const SUBJECTS: { subject: string; bank: Record<string, Seed[]> }[] = [
  { subject: "Maths", bank: read("class7Maths.json") },
  { subject: "Social Science", bank: read("class7Social.json") },
];
const HOMEWORK = read<Record<string, Record<string, HomeworkText>>>("class7Homework.json");

const HOMEWORK_QUESTIONS = 8;
const HOMEWORK_DUE_DAYS = 30;

async function main() {
  await connectDB();

  for (const { subject, bank } of SUBJECTS) {
    let added = 0;
    let skipped = 0;
    for (const [chapterSlug, seeds] of Object.entries(bank)) {
      for (const q of seeds) {
        const exists = await Question.findOne({ className: CLASS, subject, chapterSlug, text: q.text });
        if (exists) {
          skipped += 1;
          continue;
        }
        await Question.create({
          className: CLASS,
          subject,
          chapterSlug,
          ...q,
          // "both": serves the Question Bank and the adaptive Quiz.
          usage: "both",
          createdByRole: "admin",
        });
        added += 1;
      }
    }

    console.log(`${subject}: ${added} questions added, ${skipped} already present.`);
    for (const slug of Object.keys(bank)) {
      const n = await Question.countDocuments({ className: CLASS, subject, chapterSlug: slug });
      console.log(`  ${slug.padEnd(26)} ${n}`);
    }
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
  for (const { subject } of SUBJECTS) {
    for (const [chapterSlug, h] of Object.entries(HOMEWORK[subject] || {})) {
      const exists = await Homework.findOne({ className: CLASS, subject, title: h.title });
      if (exists) {
        // Keep homework made before written questions existed up to date.
        if (!exists.writtenQuestions || exists.writtenQuestions.length === 0) {
          exists.writtenQuestions = h.written;
          await exists.save();
          console.log(`~ homework: ${h.title} (+${h.written.length} written questions)`);
        }
        continue;
      }

      const qs = await Question.find({ className: CLASS, subject, chapterSlug })
        .limit(HOMEWORK_QUESTIONS)
        .select("_id");
      if (qs.length === 0) continue;

      await Homework.create({
        className: CLASS,
        subject,
        chapterSlug,
        title: h.title,
        instructions: h.instructions,
        questionIds: qs.map((q) => q._id),
        writtenQuestions: h.written,
        dueAt: new Date(Date.now() + HOMEWORK_DUE_DAYS * 24 * 60 * 60 * 1000),
        assignedById: teacher._id,
        assignedByRole: "teacher",
        isPublished: true,
      });
      hwAdded += 1;
      console.log(`+ homework: ${h.title} (${qs.length} questions)`);
    }
  }
  console.log(`Homework: ${hwAdded} added.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
