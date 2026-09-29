/**
 * Tops a student's coin balance up to a target amount.
 *
 *   npm run coins:grant -- student@edulearn.com 1000
 *
 * Goes through awardCoins, so the grant is a line in the ledger like any other
 * credit. Safe to re-run: it adds only the difference, and does nothing when
 * the balance is already at or above the target.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import { awardCoins } from "../services/coinService";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const email = String(args[0] ?? "").trim().toLowerCase();
  const target = Math.floor(Number(args[1]));
  if (!email || !Number.isFinite(target) || target <= 0) {
    console.error("Usage: npm run coins:grant -- <student email> <target balance>");
    process.exit(1);
  }

  await connectDB();
  const user = await User.findOne({ email }).select("role progress.coins");
  if (!user) {
    console.error(`No account with the email ${email}.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (user.role !== "student") {
    console.error(`${email} is a ${user.role}; only students hold coins.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const balance = user.progress?.coins ?? 0;
  if (balance >= target) {
    console.log(`${email} already has ${balance} coins, nothing to add.`);
  } else {
    const result = await awardCoins(
      String(user._id),
      target - balance,
      "admin_grant",
      `admin_grant:${user._id}:${Date.now()}`
    );
    console.log(`${email}: ${balance} -> ${result.balance} coins.`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
