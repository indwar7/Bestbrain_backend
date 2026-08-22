import crypto from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { User } from "../models/User";
import { awardCoins } from "./coinService";
import {
  Subscription,
  ISubscription,
  SubscriptionStatus,
  SUBSCRIPTION_STATUSES,
  isEntitling,
} from "../models/Subscription";

// Coins are credited 1-for-1 with what was actually paid, in rupees — ₹900
// becomes 900 coins. That number is a DISPLAY choice (see coinService.ts's
// spendCoins usage in pal/videoController for the real internal cost basis:
// 3 coins ≈ ₹1 of actual compute budget, so 900 coins is calibrated to cover
// roughly ₹300 of real usage, not ₹900 — see the coin-economy design notes).
// Reading it off doc.amount rather than hard-coding 900 means a future price
// change is a Razorpay-side config change, not a code change here.
function coinsForPayment(amountPaise: number): number {
  return Math.round(amountPaise / 100);
}

/**
 * BestBrain Plus subscriptions.
 *
 * Everything here is driven by Razorpay webhooks. We never ask the browser
 * whether a payment succeeded — a client can say anything, and the hosted
 * button gives it no proof it could not forge. The webhook is signed with a
 * shared secret, so it is the only statement about payment this server trusts.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Webhook signature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when `rawBody` really was signed by Razorpay with our webhook secret.
 *
 * `rawBody` must be the exact bytes received. Re-serialising the parsed JSON
 * does NOT round-trip (key order, unicode escaping, whitespace) and produces a
 * different HMAC, so app.ts stashes the raw buffer before express.json() runs.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.razorpayWebhookConfigured) return false;
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", env.razorpayWebhookSecret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through the error path — compare lengths first and bail.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Webhook payload
// ─────────────────────────────────────────────────────────────────────────────

interface RazorpayWebhookEvent {
  event?: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: Record<string, unknown> };
    payment?: { entity?: Record<string, unknown> };
  };
}

/** Razorpay sends unix *seconds*; `new Date(seconds)` would land in 1970. */
function toDate(seconds: unknown): Date | null {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normaliseStatus(v: unknown): SubscriptionStatus | null {
  const s = asString(v);
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s)
    ? (s as SubscriptionStatus)
    : null;
}

export interface ApplyResult {
  handled: boolean;
  reason?: string;
  subscriptionId?: string;
  linkedUserId?: string;
}

/**
 * Apply one verified webhook event.
 *
 * Only subscription.* events are acted on; Razorpay accounts commonly have
 * other events enabled and those must be acknowledged, not errored, or Razorpay
 * retries them forever.
 */
export async function applyWebhookEvent(
  event: RazorpayWebhookEvent,
  eventId: string
): Promise<ApplyResult> {
  const name = asString(event.event);
  if (!name.startsWith("subscription.")) {
    return { handled: false, reason: `ignored event ${name || "(unnamed)"}` };
  }

  const entity = event.payload?.subscription?.entity;
  if (!entity) return { handled: false, reason: "no subscription entity in payload" };

  const subId = asString(entity.id);
  if (!subId) return { handled: false, reason: "subscription entity has no id" };

  const eventAt = toDate(event.created_at);
  const existing = await Subscription.findOne({ razorpaySubscriptionId: subId });

  // Idempotency + ordering. Razorpay retries on any non-2xx and retries can
  // arrive out of order, so an event older than the one already applied must
  // not overwrite newer state (e.g. a late "activated" retry must not
  // resurrect a subscription that has since been cancelled).
  if (existing) {
    if (eventId && existing.lastEventId === eventId) {
      return { handled: true, reason: "duplicate event", subscriptionId: subId };
    }
    if (eventAt && existing.lastEventAt && eventAt < existing.lastEventAt) {
      return { handled: true, reason: "stale event", subscriptionId: subId };
    }
  }

  // The payment entity is the only place the payer's email/contact appears, and
  // it is only present on charge events — so keep any previously learned value
  // when this event does not carry one.
  const payment = event.payload?.payment?.entity;
  const email = asString(payment?.email) || existing?.email || "";
  const contact = asString(payment?.contact) || existing?.contact || "";

  const status = normaliseStatus(entity.status) ?? existing?.status ?? "created";

  // Captured before doc.currentStart is overwritten below — this is what lets
  // us tell "the same period, re-applied" apart from "a new period started",
  // which is the only signal we have for "credit this cycle's coins" that
  // doesn't depend on which specific event name Razorpay used to say so.
  const previousCurrentStart = existing?.currentStart ?? null;

  const doc = existing ?? new Subscription({ razorpaySubscriptionId: subId });
  doc.razorpayCustomerId = asString(entity.customer_id) || doc.razorpayCustomerId;
  doc.razorpayPlanId = asString(entity.plan_id) || doc.razorpayPlanId;
  doc.email = email;
  doc.contact = contact;
  doc.status = status;
  doc.currentStart = toDate(entity.current_start) ?? doc.currentStart;
  doc.currentEnd = toDate(entity.current_end) ?? doc.currentEnd;
  if (payment?.amount != null) doc.amount = Number(payment.amount) || doc.amount;
  if (payment?.currency) doc.currency = asString(payment.currency);
  doc.lastEventId = eventId || doc.lastEventId;
  doc.lastEventAt = eventAt ?? doc.lastEventAt;

  // If we ever create subscriptions server-side we attach the account id in
  // notes — that is unambiguous, so it wins over email matching. Supporting it
  // now costs nothing and makes the upgrade path a config change.
  const noteUserId = extractUserIdFromNotes(entity.notes);
  if (noteUserId && mongoose.isValidObjectId(noteUserId)) {
    doc.userId = new mongoose.Types.ObjectId(noteUserId);
  } else if (!doc.userId && email) {
    const owner = await User.findOne({ email: email.toLowerCase() }).select("_id");
    if (owner) doc.userId = owner._id as mongoose.Types.ObjectId;
  }

  await doc.save();

  if (doc.userId) {
    await syncUserSnapshot(doc.userId.toString());

    // A new billing period started (first activation counts too, since
    // previousCurrentStart is null then) and it's a period the subscriber is
    // actually entitled for — credit this cycle's coins, once, idempotently
    // per (subscription, cycle) so a retried webhook can never double-credit.
    const cycleChanged =
      doc.currentStart != null &&
      (!previousCurrentStart || previousCurrentStart.getTime() !== doc.currentStart.getTime());
    if (cycleChanged && isEntitling(doc)) {
      const coins = coinsForPayment(doc.amount);
      if (coins > 0) {
        const refId = `subscription:${subId}:cycle:${doc.currentStart!.toISOString()}`;
        const result = await awardCoins(doc.userId.toString(), coins, "subscription_plus_monthly", refId);
        if (result.awarded) {
          logger.info(
            { userId: doc.userId.toString(), subscriptionId: subId, coins, balance: result.balance },
            "[subscription] credited coins for new billing cycle"
          );
        }
      }
    }
  } else {
    // Not an error: the payer has no BestBrain account yet. claimForUser()
    // picks this up when they sign up or log in with the same email.
    logger.warn(
      { subscriptionId: subId, email: email || "(none)" },
      "[subscription] payment recorded but no matching account yet — will be claimed on signup/login"
    );
  }

  return {
    handled: true,
    subscriptionId: subId,
    linkedUserId: doc.userId?.toString(),
  };
}

function extractUserIdFromNotes(notes: unknown): string {
  if (!notes || typeof notes !== "object") return "";
  const n = notes as Record<string, unknown>;
  return asString(n.userId) || asString(n.user_id) || "";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entitlement
// ─────────────────────────────────────────────────────────────────────────────

export interface Entitlement {
  active: boolean;
  status: string;
  paidThrough: Date | null;
  razorpaySubscriptionId: string;
}

const NO_ENTITLEMENT: Entitlement = {
  active: false,
  status: "none",
  paidThrough: null,
  razorpaySubscriptionId: "",
};

/**
 * Recompute a user's entitlement from their subscription rows and write the
 * snapshot onto the user. Called after every webhook that touches them, and
 * after a claim.
 *
 * A user can legitimately have several rows (they resubscribed after letting
 * one lapse), so the winner is the one that keeps access longest.
 */
export async function syncUserSnapshot(userId: string): Promise<Entitlement> {
  const subs = await Subscription.find({ userId });
  const entitlement = bestEntitlement(subs);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "subscription.status": entitlement.status,
        "subscription.active": entitlement.active,
        "subscription.paidThrough": entitlement.paidThrough,
        "subscription.razorpaySubscriptionId": entitlement.razorpaySubscriptionId,
        "subscription.updatedAt": new Date(),
      },
    }
  );

  return entitlement;
}

function bestEntitlement(subs: ISubscription[]): Entitlement {
  if (subs.length === 0) return { ...NO_ENTITLEMENT };

  const entitling = subs.filter(isEntitling);
  if (entitling.length > 0) {
    // Longest remaining access wins.
    const best = entitling.reduce((a, b) =>
      (b.currentEnd?.getTime() ?? Infinity) > (a.currentEnd?.getTime() ?? Infinity) ? b : a
    );
    return {
      active: true,
      status: best.status,
      paidThrough: best.currentEnd,
      razorpaySubscriptionId: best.razorpaySubscriptionId,
    };
  }

  // Nothing entitling — report the most recently updated row so the UI can say
  // "expired" or "payment failed" rather than "never subscribed".
  const latest = subs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return {
    active: false,
    status: latest.status,
    paidThrough: latest.currentEnd,
    razorpaySubscriptionId: latest.razorpaySubscriptionId,
  };
}

/** Live entitlement for a user, read from the subscription rows themselves. */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const subs = await Subscription.find({ userId });
  return bestEntitlement(subs);
}

/**
 * Attach any subscription paid for with this user's email but not yet linked to
 * an account, then refresh their snapshot.
 *
 * This is what makes the hosted button work for someone who paid before they
 * had an account — the common case, since the button sits on a public pricing
 * page. Safe to call on every login: it is a no-op once there is nothing
 * unlinked left to claim.
 */
export async function claimForUser(user: { id: string; email: string }): Promise<Entitlement> {
  const email = (user.email ?? "").toLowerCase().trim();
  if (!email) return getEntitlement(user.id);

  // Found (not just updateMany'd) because a subscription claimed here — paid
  // for before the account existed — never passed through applyWebhookEvent's
  // cycle-detection with a userId attached, so its current cycle's coins were
  // never credited. That has to happen here instead, once, for each one.
  const unclaimed = await Subscription.find({ userId: null, email });
  if (unclaimed.length > 0) {
    await Subscription.updateMany({ userId: null, email }, { $set: { userId: user.id } });
    logger.info(
      { userId: user.id, claimed: unclaimed.length },
      "[subscription] linked previously unclaimed subscription(s) to account"
    );

    for (const sub of unclaimed) {
      if (!isEntitling(sub) || !sub.currentStart) continue;
      const coins = coinsForPayment(sub.amount);
      if (coins <= 0) continue;
      const refId = `subscription:${sub.razorpaySubscriptionId}:cycle:${sub.currentStart.toISOString()}`;
      await awardCoins(user.id, coins, "subscription_plus_monthly", refId);
    }
  }

  return syncUserSnapshot(user.id);
}
