import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { CoinLedger } from "../models/CoinLedger";
import { spendCoins as spendCoinsService } from "../services/coinService";

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
  const result = await spendCoinsService(userId, cost, "spend:" + reason, refId);

  if (result.duplicate) {
    res.json({
      spent: false,
      duplicate: true,
      balance: result.balance,
      message: "This charge was already applied.",
    });
    return;
  }
  if (!result.spent) {
    res.status(400).json({ spent: false, balance: result.balance, error: "Not enough coins" });
    return;
  }

  res.json({ spent: true, charged: cost, balance: result.balance });
}
