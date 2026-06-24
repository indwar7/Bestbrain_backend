// Seeds a small question bank so Mock Tests and the Challenge have content.
// Run with: npx tsx src/scripts/seedQuestions.ts
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Question } from "../models/Question";

const QUESTIONS: Array<{
  className: string; subject: string; text: string; options: string[];
  correctIndex: number; explanation: string; difficulty: "easy" | "medium" | "hard";
}> = [
  { className: "Class 7", subject: "Maths", text: "What is 1/2 + 1/4?", options: ["3/4", "1/6", "2/6", "1/2"], correctIndex: 0, explanation: "Common denominator 4: 2/4 + 1/4 = 3/4.", difficulty: "easy" },
  { className: "Class 7", subject: "Maths", text: "Solve: 3x = 12", options: ["x=2", "x=3", "x=4", "x=6"], correctIndex: 2, explanation: "12 / 3 = 4.", difficulty: "easy" },
  { className: "Class 7", subject: "Maths", text: "Area of a rectangle 5 x 3?", options: ["8", "15", "16", "53"], correctIndex: 1, explanation: "length x breadth = 15.", difficulty: "easy" },
  { className: "Class 7", subject: "Science", text: "Water boils at?", options: ["50C", "90C", "100C", "120C"], correctIndex: 2, explanation: "At sea level water boils at 100C.", difficulty: "easy" },
  { className: "Class 7", subject: "Science", text: "Photosynthesis happens in?", options: ["Roots", "Leaves", "Stem", "Flower"], correctIndex: 1, explanation: "Chlorophyll in leaves captures sunlight.", difficulty: "medium" },
  { className: "Class 7", subject: "Science", text: "The gas plants release is?", options: ["CO2", "Nitrogen", "Oxygen", "Hydrogen"], correctIndex: 2, explanation: "Plants release oxygen during photosynthesis.", difficulty: "easy" },
  { className: "Class 8", subject: "Maths", text: "Square of 9?", options: ["18", "72", "81", "99"], correctIndex: 2, explanation: "9 x 9 = 81.", difficulty: "easy" },
  { className: "Class 8", subject: "Science", text: "Unit of force?", options: ["Joule", "Newton", "Watt", "Pascal"], correctIndex: 1, explanation: "Force is measured in Newtons.", difficulty: "medium" },
];

async function main() {
  await connectDB();
  let added = 0;
  for (const q of QUESTIONS) {
    const exists = await Question.findOne({ className: q.className, subject: q.subject, text: q.text });
    if (exists) continue;
    await Question.create({ ...q, usage: "both", createdByRole: "admin" });
    added += 1;
    console.log(`+ ${q.className}/${q.subject}: ${q.text}`);
  }
  console.log(`Done. Added ${added} questions.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
