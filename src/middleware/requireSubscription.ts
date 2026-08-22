import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { User } from "../models/User";
import { claimForUser } from "../services/subscriptionService";

/**
 * Gates a route behind an active BestBrain Plus subscription.
 * Must run after `requireAuth` — it reads `req.user`.
 *
 * Usage:  router.get("/x", requireAuth, requireSubscription, handler)
 *
 * The check is against `paidThrough`, not the stored `active` flag, because
 * that flag is a derivation frozen at its last write: a subscription that
 * lapsed an hour ago still has `active: true` until something re-syncs it.
 * Comparing the date is what makes expiry take effect on time.
 */
export async function requireSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await User.findById(req.user!.id).select("subscription email");
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (hasLiveAccess(user.subscription)) return next();

  // The snapshot says no — but it can be stale in the user's favour too: they
  // may have just paid, or paid before signing up, and nothing has linked it
  // yet. Re-derive from the subscription rows once before refusing, so a
  // legitimate subscriber is never told to pay twice.
  const fresh = await claimForUser({ id: req.user!.id, email: user.email });
  if (fresh.active) return next();

  res.status(402).json({
    error: "A BestBrain Plus subscription is required for this.",
    code: "subscription_required",
    status: fresh.status,
  });
}

function hasLiveAccess(sub?: { active?: boolean; paidThrough?: Date | null }): boolean {
  if (!sub?.active) return false;
  if (!sub.paidThrough) return true; // active with no end date — trust it
  return sub.paidThrough.getTime() > Date.now();
}
