/**
 * Imports multiple-choice questions from a CSV (Excel: File > Save As > CSV UTF-8)
 * into the question bank, so a licensed question book can be loaded in one go.
 *
 *   npm run import:questions -- path/to/file.csv --dry-run     # check only
 *   npm run import:questions -- path/to/file.csv               # import
 *   options: --class "Class 7"  --subject Science  --usage both
 *
 * Columns (header row required, any order, case-insensitive):
 *   chapter      chapter number (NCERT order, 1-12), slug ("heat-transfer") or name
 *   question     the question text
 *   option_a ... option_d   (option_e, option_f optional)
 *   answer       A / B / C / D (or the option text itself)
 *   explanation  why the answer is right (optional, recommended)
 *   difficulty   easy / medium / hard (optional, default medium)
 *
 * Every row is checked first; nothing is written if a row is broken, and the
 * report says which rows and why. Re-running is safe: a question already in
 * the bank for that chapter (same text) is skipped.
 * A template is in templates/questions-template.csv.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Question } from "../models/Question";
import { topicMatches } from "../utils/topicMatch";

// Class 7 Science (NCERT "Curiosity"), in the book's chapter order.
const CHAPTERS_BY_CLASS_SUBJECT: Record<string, { slug: string; name: string }[]> = {
  "Class 7|Science": [
    { slug: "evolving-science", name: "The Ever-Evolving World of Science" },
    { slug: "acidic-basic-neutral", name: "Exploring Substances: Acidic, Basic and Neutral" },
    { slug: "electricity-circuits", name: "Electricity: Circuits and their Components" },
    { slug: "metals-nonmetals", name: "The World of Metals and Non-metals" },
    { slug: "physical-chemical-changes", name: "Changes Around Us: Physical and Chemical" },
    { slug: "adolescence", name: "Adolescence: A Stage of Growth and Change" },
    { slug: "heat-transfer", name: "Heat Transfer in Nature" },
    { slug: "time-and-motion", name: "Measurement of Time and Motion" },
    { slug: "life-processes-animals", name: "Life Processes in Animals" },
    { slug: "life-processes-plants", name: "Life Processes in Plants" },
    { slug: "light-shadows", name: "Light: Shadows and Reflections" },
    { slug: "earth-moon-sun", name: "Earth, Moon and the Sun" },
  ],
};

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && a.endsWith(".csv"));
  const dryRun = process.argv.includes("--dry-run");
  const className = arg("--class") || "Class 7";
  const subject = arg("--subject") || "Science";
  const usage = (arg("--usage") || "both") as "both" | "bank" | "mock" | "challenge";
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: npm run import:questions -- <file.csv> [--dry-run] [--class \"Class 7\"] [--subject Science]");
    process.exit(1);
  }
  const chapters = CHAPTERS_BY_CLASS_SUBJECT[`${className}|${subject}`];
  if (!chapters) {
    console.error(`No chapter list for ${className} ${subject} yet; add it to CHAPTERS_BY_CLASS_SUBJECT.`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(path.resolve(file), "utf8"));
  const head = rows.shift()!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (r: string[], name: string) => (head.indexOf(name) === -1 ? "" : (r[head.indexOf(name)] || "").trim());
  for (const need of ["chapter", "question", "option_a", "option_b", "answer"]) {
    if (!head.includes(need)) { console.error(`Missing column "${need}". Columns found: ${head.join(", ")}`); process.exit(1); }
  }

  const findChapter = (v: string) => {
    if (/^\d+$/.test(v)) return chapters[Number(v) - 1];
    return chapters.find((c) => c.slug === v.toLowerCase()) ||
      chapters.find((c) => c.name.toLowerCase() === v.toLowerCase()) ||
      chapters.find((c) => topicMatches(c.slug.replace(/-/g, " "), v));
  };

  type Row = { line: number; chapterSlug: string; text: string; options: string[]; correctIndex: number; explanation: string; difficulty: "easy" | "medium" | "hard" };
  const good: Row[] = [];
  const bad: string[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const ch = findChapter(col(r, "chapter"));
    const text = col(r, "question");
    const options = ["a", "b", "c", "d", "e", "f"].map((k) => col(r, "option_" + k)).filter(Boolean);
    const ans = col(r, "answer");
    let correctIndex = /^[A-Fa-f]$/.test(ans) ? ans.toUpperCase().charCodeAt(0) - 65 : options.findIndex((o) => o.toLowerCase() === ans.toLowerCase());
    const diff = (col(r, "difficulty") || "medium").toLowerCase();
    const problems: string[] = [];
    if (!ch) problems.push(`unknown chapter "${col(r, "chapter")}"`);
    if (!text) problems.push("no question text");
    if (options.length < 2) problems.push("fewer than 2 options");
    if (!(correctIndex >= 0 && correctIndex < options.length)) problems.push(`answer "${ans}" does not match an option`);
    if (!["easy", "medium", "hard"].includes(diff)) problems.push(`difficulty "${diff}" is not easy/medium/hard`);
    if (problems.length) { bad.push(`row ${line}: ${problems.join("; ")}`); return; }
    good.push({ line, chapterSlug: ch!.slug, text, options, correctIndex, explanation: col(r, "explanation"), difficulty: diff as Row["difficulty"] });
  });

  console.log(`${file}: ${rows.length} rows, ${good.length} valid, ${bad.length} with problems.`);
  for (const c of chapters) {
    const n = good.filter((g) => g.chapterSlug === c.slug).length;
    if (n) console.log(`  ${c.name.padEnd(48)} ${n}`);
  }
  if (bad.length) {
    console.log("\nFix these rows and run again (nothing was imported):");
    bad.slice(0, 50).forEach((b) => console.log("  " + b));
    if (bad.length > 50) console.log(`  ...and ${bad.length - 50} more`);
    process.exit(1);
  }
  if (dryRun) { console.log("\nDry run: everything checks out. Run again without --dry-run to import."); return; }

  await connectDB();
  let added = 0, skipped = 0;
  for (const g of good) {
    const exists = await Question.findOne({ className, subject, chapterSlug: g.chapterSlug, text: g.text });
    if (exists) { skipped++; continue; }
    await Question.create({
      className, subject, chapterSlug: g.chapterSlug, text: g.text, options: g.options,
      correctIndex: g.correctIndex, explanation: g.explanation, difficulty: g.difficulty,
      usage, createdByRole: "admin",
    });
    added++;
  }
  console.log(`\nImported ${added} questions (${skipped} already in the bank).`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
