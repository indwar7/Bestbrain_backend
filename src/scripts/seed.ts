// Seeds demo accounts for all three roles with role-specific fields.
// Run with: npm run seed
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import mongoose from "mongoose";

const PASSWORD = "Demo@2024";

async function seed() {
  await connectDB();

  const emails = [
    "student@edulearn.com",
    "student2@edulearn.com",
    "parent@edulearn.com",
    "teacher@edulearn.com",
  ];
  await User.deleteMany({ email: { $in: emails } });

  const hash = await bcrypt.hash(PASSWORD, 10);

  // 1. STUDENT — Class 7, Section A, roll EDU-7A-021
  const student = await User.create({
    name: "Aarav Sharma",
    email: "student@edulearn.com",
    phone: "+91-9000000000",
    password: hash,
    role: "student",
    rollNumber: "EDU-7A-021",
    className: "Class 7",
    section: "A",
    board: "CBSE",
    subjects: ["Science", "Maths"],
    classLabel: "Class 7 · A",
    progress: {
      lang: "en",
      minutes: 420,
      streak: 6,
      badges: ["First Lesson", "7-Day Streak", "Quiz Master"],
      chapters: {
        "science-motion": { completed: true, exercises: 8, correct: 7 },
      },
      pal: {},
    },
  });

  // 2. Another STUDENT — Class 7, Section B
  await User.create({
    name: "Diya Mehta",
    email: "student2@edulearn.com",
    phone: "+91-9000000000",
    password: hash,
    role: "student",
    rollNumber: "EDU-7B-008",
    className: "Class 7",
    section: "B",
    board: "CBSE",
    subjects: ["Science"],
    classLabel: "Class 7 · B",
    progress: { lang: "en", minutes: 120, streak: 2, badges: [], chapters: {}, pal: {} },
  });

  // 3. PARENT — linked to Aarav via roll number + name + class
  await User.create({
    name: "Meera Sharma",
    email: "parent@edulearn.com",
    phone: "+91-9000000000",
    password: hash,
    role: "parent",
    childLinks: [
      {
        studentId: student._id,
        rollNumber: "EDU-7A-021",
        relation: "mother",
        status: "verified",
      },
    ],
  });

  // 4. TEACHER — teacherId TCH-104, teaches Class 7-A Science & Maths
  await User.create({
    name: "Mr. Verma",
    email: "teacher@edulearn.com",
    phone: "+91-9000000000",
    password: hash,
    role: "teacher",
    teacherId: "TCH-104",
    teaches: [
      { className: "Class 7", section: "A", subject: "Science" },
      { className: "Class 7", section: "A", subject: "Maths" },
    ],
  });

  console.log("✅ Seeded demo accounts (password for all: " + PASSWORD + ")");
  console.log("   STUDENT  student@edulearn.com   roll EDU-7A-021, Class 7-A CBSE");
  console.log("   STUDENT  student2@edulearn.com  roll EDU-7B-008, Class 7-B");
  console.log("   PARENT   parent@edulearn.com    linked to Aarav (EDU-7A-021)");
  console.log("   TEACHER  teacher@edulearn.com   id TCH-104, Class 7-A Science/Maths");

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
