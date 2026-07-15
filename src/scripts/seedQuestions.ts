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

  // --- Class 6 Science (so the arena/challenge isn't empty for Class 6) ---
  { className: "Class 6", subject: "Science", text: "Which nutrient gives us the most energy?", options: ["Proteins", "Carbohydrates", "Vitamins", "Minerals"], correctIndex: 1, explanation: "Carbohydrates are the body's main energy source.", difficulty: "easy" },
  { className: "Class 6", subject: "Science", text: "Scurvy is caused by the deficiency of which vitamin?", options: ["Vitamin A", "Vitamin B", "Vitamin C", "Vitamin D"], correctIndex: 2, explanation: "Lack of Vitamin C causes scurvy (bleeding gums).", difficulty: "medium" },
  { className: "Class 6", subject: "Science", text: "Which of these is a rich source of protein?", options: ["Rice", "Pulses (dal)", "Sugar", "Butter"], correctIndex: 1, explanation: "Pulses like dal are a major protein source.", difficulty: "easy" },
  { className: "Class 6", subject: "Science", text: "Cotton fibre is obtained from the ____ of the cotton plant.", options: ["Roots", "Stem", "Bolls (fruit)", "Leaves"], correctIndex: 2, explanation: "Cotton comes from the fluffy bolls of the plant.", difficulty: "easy" },
  { className: "Class 6", subject: "Science", text: "Which material is transparent?", options: ["Wood", "Cardboard", "Clear glass", "Stone"], correctIndex: 2, explanation: "You can see through transparent materials like clear glass.", difficulty: "easy" },
  { className: "Class 6", subject: "Science", text: "Separating heavier grain from lighter husk using wind is called?", options: ["Threshing", "Winnowing", "Filtration", "Sieving"], correctIndex: 1, explanation: "Winnowing uses air/wind to separate husk from grain.", difficulty: "medium" },
  { className: "Class 6", subject: "Science", text: "Which of these is a magnetic material?", options: ["Iron", "Plastic", "Wood", "Rubber"], correctIndex: 0, explanation: "Iron is attracted by a magnet; the others are not.", difficulty: "easy" },
  { className: "Class 6", subject: "Science", text: "A shadow forms because light travels in?", options: ["Curved paths", "Straight lines", "Circles", "Zig-zags"], correctIndex: 1, explanation: "Light travels in straight lines, so opaque objects cast shadows.", difficulty: "easy" },

  // --- Class 7 Science (extra questions to fill the arena/challenge) ---
  { className: "Class 7", subject: "Science", text: "The mode of nutrition in green plants is?", options: ["Heterotrophic", "Autotrophic", "Parasitic", "Saprophytic"], correctIndex: 1, explanation: "Green plants make their own food, so they are autotrophic.", difficulty: "medium" },
  { className: "Class 7", subject: "Science", text: "Which device is used to measure temperature?", options: ["Barometer", "Thermometer", "Anemometer", "Speedometer"], correctIndex: 1, explanation: "A thermometer measures temperature.", difficulty: "easy" },
  { className: "Class 7", subject: "Science", text: "Litmus solution turns red in a ____ solution.", options: ["Basic", "Neutral", "Acidic", "Salty"], correctIndex: 2, explanation: "Acids turn blue litmus red.", difficulty: "medium" },
  { className: "Class 7", subject: "Science", text: "The normal temperature of the human body is about?", options: ["30 C", "37 C", "42 C", "25 C"], correctIndex: 1, explanation: "Normal body temperature is about 37 C.", difficulty: "easy" },
  { className: "Class 7", subject: "Science", text: "Loss of water vapour from a plant's leaves is called?", options: ["Respiration", "Transpiration", "Digestion", "Germination"], correctIndex: 1, explanation: "Transpiration is water vapour escaping through the leaves.", difficulty: "medium" },
  { className: "Class 7", subject: "Science", text: "Which instrument measures wind speed?", options: ["Anemometer", "Thermometer", "Rain gauge", "Compass"], correctIndex: 0, explanation: "An anemometer measures wind speed.", difficulty: "hard" },
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
