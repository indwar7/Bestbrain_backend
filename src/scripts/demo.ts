// One-shot demo bootstrap: starts the server (in-memory DB) AND seeds the
// 3 demo accounts in the SAME process, so logins work immediately.
// Run with: npm run demo
import http from "http";
import bcrypt from "bcryptjs";
import { app } from "../app";
import { connectDB } from "../config/db";
import { env } from "../config/env";
import { initLiveSocket } from "../sockets/liveSocket";
import { User } from "../models/User";

const PASSWORD = "Demo@2024";

async function seedInline() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const student = await User.create({
    name: "Aarav Sharma",
    email: "student@edulearn.com",
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
      chapters: { "science-motion": { completed: true, exercises: 8, correct: 7 } },
      pal: {},
    },
  });

  await User.create({
    name: "Diya Mehta",
    email: "student2@edulearn.com",
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

  await User.create({
    name: "Meera Sharma",
    email: "parent@edulearn.com",
    password: hash,
    role: "parent",
    childLinks: [
      { studentId: student._id, rollNumber: "EDU-7A-021", relation: "mother", status: "verified" },
    ],
  });

  await User.create({
    name: "Mr. Verma",
    email: "teacher@edulearn.com",
    password: hash,
    role: "teacher",
    teacherId: "TCH-104",
    teaches: [
      { className: "Class 7", section: "A", subject: "Science" },
      { className: "Class 7", section: "A", subject: "Maths" },
    ],
  });
}

async function start() {
  await connectDB();
  await seedInline();

  const server = http.createServer(app);
  initLiveSocket(server);

  server.listen(env.port, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  EduLearn backend + demo data ready                    ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  API:  http://localhost:${env.port}                          ║`);
    console.log("║  Demo logins (password: Demo@2024):                    ║");
    console.log("║    student@edulearn.com   → Student dashboard          ║");
    console.log("║    teacher@edulearn.com   → Teacher dashboard          ║");
    console.log("║    parent@edulearn.com    → Parent dashboard           ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("Watching requests below — registrations & logins appear live:\n");
  });
}

start();
