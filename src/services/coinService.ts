import { User } from "../models/User";
import { CoinLedger } from "../models/CoinLedger";

export interface SpendResult {
  spent: boolean;
  duplicate?: boolean;
  balance: number;
}

/**
 * Award coins to a student, at most once per refId.
 *
 * Earning already existed in two places, progress sync writes ledger lines in
 * a batch, and spending deducts in coinsController, but neither is reusable
 * for "pay for this one thing, and only the first time". The question bank
 * needs exactly that: a student may answer the same question again as often
 * as they like, and must be paid for it once.
 *
 * The ledger's unique { userId, refId } index is what enforces that, not a
 * read-then-write here. Two requests that arrive together will both find no
 * existing line and both try to insert; the index rejects the second, and
 * that request undoes its own increment. Checking first is only an
 * optimisation that keeps the common case to one query.
 */
export async function awardCoins(
  userId: string,
  delta: number,
  reason: string,
  refId: string
): Promise<{ awarded: boolean; balance: number }> {
  if (!Number.isInteger(delta) || delta <= 0) {
    const u = await User.findById(userId).select("progress.coins");
    return { awarded: false, balance: u?.progress?.coins ?? 0 };
  }

  const already = await CoinLedger.findOne({ userId, refId }).lean();
  if (already) {
    const u = await User.findById(userId).select("progress.coins");
    return { awarded: false, balance: u?.progress?.coins ?? 0 };
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { "progress.coins": delta } },
    { new: true }
  ).select("progress.coins");

  if (!updated) return { awarded: false, balance: 0 };
  const balance = updated.progress?.coins ?? 0;

  try {
    await CoinLedger.create({ userId, delta, reason, refId, balanceAfter: balance });
    return { awarded: true, balance };
  } catch {
    // A concurrent request for the same refId already recorded this award, so
    // this one has paid twice. Take it back, the ledger decides the balance.
    await User.updateOne({ _id: userId }, { $inc: { "progress.coins": -delta } });
    const u = await User.findById(userId).select("progress.coins");
    return { awarded: false, balance: u?.progress?.coins ?? 0 };
  }
}

/**
 * Spend coins against a student's balance, at most once per refId.
 *
 * Extracted from coinsController's HTTP handler (which still owns the public
 * /api/coins/spend endpoint, where amount/reason are client-supplied) so
 * server-side gates - PAL questions, video views, can charge a
 * SERVER-DECIDED amount without going through their own HTTP round-trip, and
 * without trusting a client-supplied cost. Same idempotency contract as
 * awardCoins: the ledger's unique {userId, refId} index is what makes a
 * concurrent double-call charge at most once, not a read-then-write here.
 */
export async function spendCoins(
  userId: string,
  cost: number,
  reason: string,
  refId: string
): Promise<SpendResult> {
  if (!Number.isInteger(cost) || cost <= 0) {
    const u = await User.findById(userId).select("progress.coins");
    return { spent: false, balance: u?.progress?.coins ?? 0 };
  }

  const already = await CoinLedger.findOne({ userId, refId }).lean();
  if (already) {
    const u = await User.findById(userId).select("progress.coins");
    return { spent: false, duplicate: true, balance: u?.progress?.coins ?? 0 };
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
    return { spent: false, balance: u?.progress?.coins ?? 0 };
  }

  const balance = updated.progress?.coins ?? 0;

  try {
    await CoinLedger.create({ userId, delta: -cost, reason, refId, balanceAfter: balance });
    return { spent: true, balance };
  } catch {
    // The unique index rejected it, a concurrent request for the same refId
    // already recorded this spend, and this one has deducted a second time.
    // Put that back: the ledger is what decides the balance.
    await User.updateOne({ _id: userId }, { $inc: { "progress.coins": cost } });
    const u = await User.findById(userId).select("progress.coins");
    return { spent: false, duplicate: true, balance: u?.progress?.coins ?? 0 };
  }
}
