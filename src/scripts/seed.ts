// Seeds demo student / parent / teacher accounts with linked relationships.
// Run with: npm run seed
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import mongoose from "mongoose";

const PASSWORD = "Demo@2024";
const CLASS = "Class 7";

async function seed() {
  await connectDB();

  // Clear previous demo accounts (idempotent re-seed).
  await User.deleteMany({
    email: {
      $in: [
        "student@edulearn.com",
        "parent@edulearn.com",
        "teacher@edulearn.com",
      ],
    },
  });

  const hash = await bcrypt.hash(PASSWORD, 10);

  // 1. Student — with some progress so the dashboard isn't empty.
  const student = await User.create({
    name: "Aarav Sharma",
    email: "student@edulearn.com",
    password: hash,
    role: "student",
    classLabel: CLASS,
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

  // 2. Parent — linked to the student above.
  await User.create({
    name: "Meera Sharma",
    email: "parent@edulearn.com",
    password: hash,
    role: "parent",
    childIds: [student._id],
  });

  // 3. Teacher — teaches Class 7, so the student appears in their roster.
  await User.create({
    name: "Mr. Verma",
    email: "teacher@edulearn.com",
    password: hash,
    role: "teacher",
    classIds: [CLASS],
  });

  console.log("✅ Seeded demo accounts (password for all: " + PASSWORD + ")");
  console.log("   student@edulearn.com   (student)");
  console.log("   parent@edulearn.com    (parent → linked to Aarav)");
  console.log("   teacher@edulearn.com   (teacher → Class 7 roster)");

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
