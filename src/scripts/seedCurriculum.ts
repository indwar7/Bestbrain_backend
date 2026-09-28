// Seeds a sample curriculum AND backfills Chapter docs for any free-form
// chapter slugs already present in students' progress (so legacy data resolves).
// Run with: npx tsx src/scripts/seedCurriculum.ts
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import { Subject } from "../models/Subject";
import { Chapter } from "../models/Chapter";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Sample curriculum: Class 7 Maths with ordered chapters.
const SAMPLE = [
  {
    name: "Mathematics",
    className: "Class 7",
    board: "CBSE",
    chapters: [
      { title: "Integers", estimatedMinutes: 45 },
      { title: "Fractions and Decimals", slug: "ch-fractions", estimatedMinutes: 60 },
      { title: "Data Handling", estimatedMinutes: 40 },
      { title: "Simple Equations", estimatedMinutes: 50 },
    ],
  },
];

async function seedSample() {
  for (const subj of SAMPLE) {
    const slug = `${slugify(subj.name)}-${slugify(subj.className)}`;
    let subject = await Subject.findOne({ slug });
    if (!subject) {
      subject = await Subject.create({
        name: subj.name,
        slug,
        className: subj.className,
        board: subj.board,
        createdByRole: "admin",
      });
      console.log(`+ subject ${subject.name} (${subject.className})`);
    }
    let order = 1;
    for (const ch of subj.chapters) {
      const chSlug = slugify(ch.slug ?? ch.title);
      const exists = await Chapter.findOne({ subjectId: subject._id, slug: chSlug });
      if (!exists) {
        await Chapter.create({
          subjectId: subject._id,
          title: ch.title,
          slug: chSlug,
          order: order,
          estimatedMinutes: ch.estimatedMinutes,
          createdByRole: "admin",
        });
        console.log(`  + chapter ${ch.title} [${chSlug}]`);
      }
      order += 1;
    }
  }
}

// Backfill: any chapter slug used in a student's progress but not yet modeled
// gets a placeholder Chapter under an "Uncategorized" subject per class, so PAL
// and dashboards can still resolve a title.
async function backfillLegacy() {
  const students = await User.find({ role: "student" }).select("className progress").lean();
  const seen = new Set<string>();

  for (const s of students) {
    const className = s.className || "Unassigned";
    const slugs = Object.keys((s.progress as { chapters?: Record<string, unknown> })?.chapters ?? {});
    for (const rawSlug of slugs) {
      const chSlug = slugify(rawSlug);
      const dedupeKey = `${className}::${chSlug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Skip if this slug already exists under ANY subject (e.g. the sample one).
      if (await Chapter.findOne({ slug: chSlug })) continue;

      const subjSlug = `uncategorized-${slugify(className)}`;
      let subject = await Subject.findOne({ slug: subjSlug });
      if (!subject) {
        subject = await Subject.create({
          name: "Uncategorized",
          slug: subjSlug,
          className,
          createdByRole: "admin",
        });
      }
      const order = (await Chapter.countDocuments({ subjectId: subject._id })) + 1;
      await Chapter.create({
        subjectId: subject._id,
        title: rawSlug.replace(/^ch-/, "").replace(/-/g, " ").trim() || rawSlug,
        slug: chSlug,
        order,
        isPublished: false, // placeholder, not real content
        createdByRole: "admin",
      });
      console.log(`  ~ backfilled legacy chapter [${chSlug}] under ${className}`);
    }
  }
}

async function main() {
  await connectDB();
  console.log("Seeding sample curriculum…");
  await seedSample();
  console.log("Backfilling legacy chapter slugs…");
  await backfillLegacy();
  console.log("Done.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
