import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { CoinLedger } from "../models/CoinLedger";

// Coins are earned inside the progress pipeline (see progressController) —
// there is no endpoint to grant them, because a client must never be able to
// ask for a balance it did not earn. These two only read the balance and
// spend against it.

// GET /api/coins
// The balance, plus the lines behind it so a student can see where it came from.
export async function getCoins(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("progress.coins");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const recent = await CoinLedger.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(25)
    .select("delta reason balanceAfter createdAt")
    .lean();

  res.json({ balance: user.progress?.coins ?? 0, recent });
}

// POST /api/coins/spend   Body: { amount, reason, refId }
// Spends against the balance. `refId` is required and unique per student: a
// retry after a dropped response finds the spend already recorded and returns
// the same balance instead of charging twice.
export async function spendCoins(req: AuthRequest, res: Response): Promise<void> {
  const { amount, reason, refId } = req.body as {
    amount?: number;
    reason?: string;
    refId?: string;
  };

  const cost = Number(amount);
  if (!Number.isInteger(cost) || cost <= 0) {
    res.status(400).json({ error: "amount must be a positive whole number" });
    return;
  }
  if (!reason || !refId) {
    res.status(400).json({ error: "reason and refId are required" });
    return;
  }

  const userId = req.user!.id;

  // Already spent under this refId → report the current balance and stop.
  const already = await CoinLedger.findOne({ userId, refId }).lean();
  if (already) {
    const u = await User.findById(userId).select("progress.coins");
    res.json({
      spent: false,
      duplicate: true,
      balance: u?.progress?.coins ?? 0,
      message: "This charge was already applied.",
    });
    return;
  }

  // Deduct only if the balance actually covers it. The condition is part of
  // the update rather than a read followed by a write, so two requests
  // arriving together cannot both see the same balance and both succeed.
  const updated = await User.findOneAndUpdate(
    { _id: userId, "progress.coins": { $gte: cost } },
    { $inc: { "progress.coins": -cost } },
    { new: true }
  ).select("progress.coins");

  if (!updated) {
    const u = await User.findById(userId).select("progress.coins");
    res.status(400).json({
      spent: false,
      balance: u?.progress?.coins ?? 0,
      error: "Not enough coins",
    });
    return;
  }

  const balance = updated.progress?.coins ?? 0;

  try {
    await CoinLedger.create({
      userId,
      delta: -cost,
      reason: "spend:" + reason,
      refId,
      balanceAfter: balance,
    });
  } catch {
    // The unique index rejected it, so a concurrent request for the same refId
    // already recorded this spend — and, having got here, this request has
    // deducted a second time. Put that back: the ledger is what decides.
    await User.updateOne({ _id: userId }, { $inc: { "progress.coins": cost } });
    const u = await User.findById(userId).select("progress.coins");
    res.json({
      spent: false,
      duplicate: true,
      balance: u?.progress?.coins ?? 0,
      message: "This charge was already applied.",
    });
    return;
  }

  res.json({ spent: true, charged: cost, balance });
}
