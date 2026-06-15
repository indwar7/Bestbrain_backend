// Seeds demo accounts with class/section/subject data so live-class
// targeting can be demonstrated. Run with: npm run seed
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import mongoose from "mongoose";

const PASSWORD = "Demo@2024";

async function seed() {
  await connectDB();

  const emails = [
    "student@edulearn.com", // Class 7-A, Science+Maths
    "student2@edulearn.com", // Class 7-B (different section)
    "parent@edulearn.com",
    "teacher@edulearn.com",
  ];
  await User.deleteMany({ email: { $in: emails } });

  const hash = await bcrypt.hash(PASSWORD, 10);

  // 1. Student in Class 7, Section A — takes Science & Maths.
  const student = await User.create({
    name: "Aarav Sharma",
    email: "student@edulearn.com",
    password: hash,
    role: "student",
    className: "Class 7",
    section: "A",
    subjects: ["Science", "Maths"],
    classLabel: "Class 7 · A",
    progress: {
      lang: "en",
      minutes: 420,
      streak: 6,
      badges: ["First Lesson", "7-Day Streak", "Quiz Master"],
      chapters: {
        "science-motion": { completed: true, exercises: 8, correct: 7 },
        "science-light": { completed: false, exercises: 3, correct: 2 },
      },
      pal: {},
    },
  });

  // 2. Another student in Class 7, Section B — should NOT see 7-A's live class.
  await User.create({
    name: "Diya Mehta",
    email: "student2@edulearn.com",
    password: hash,
    role: "student",
    className: "Class 7",
    section: "B",
    subjects: ["Science"],
    classLabel: "Class 7 · B",
    progress: { lang: "en", minutes: 120, streak: 2, badges: [], chapters: {}, pal: {} },
  });

  // 3. Parent — linked to Aarav.
  await User.create({
    name: "Meera Sharma",
    email: "parent@edulearn.com",
    password: hash,
    role: "parent",
    childIds: [student._id],
  });

  // 4. Teacher — teaches Science for Class 7 Section A only.
  await User.create({
    name: "Mr. Verma",
    email: "teacher@edulearn.com",
    password: hash,
    role: "teacher",
    teaches: [
      { className: "Class 7", section: "A", subject: "Science" },
      { className: "Class 7", section: "A", subject: "Maths" },
    ],
  });

  console.log("✅ Seeded demo accounts (password for all: " + PASSWORD + ")");
  console.log("   student@edulearn.com   → Class 7-A, Science+Maths");
  console.log("   student2@edulearn.com  → Class 7-B, Science (won't see 7-A live)");
  console.log("   parent@edulearn.com    → linked to Aarav");
  console.log("   teacher@edulearn.com   → teaches Science/Maths for Class 7-A");

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
