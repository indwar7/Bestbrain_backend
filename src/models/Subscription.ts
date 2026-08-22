import mongoose, { Schema, Document } from "mongoose";

/**
 * One row per Razorpay subscription.
 *
 * Why this exists separately from the flag on User
 * ------------------------------------------------
 * `User.subscription` is a denormalised snapshot so a request can answer "is
 * this account paid?" in the read it was already doing. This collection is the
 * record behind it: every webhook Razorpay sends is applied here first, and the
 * snapshot is derived from it. That means entitlement can always be re-derived
 * and explained, and a bug in the snapshot is repairable rather than lossy.
 *
 * Why `userId` is nullable
 * ------------------------
 * The hosted subscription button is a public widget — it takes a payment from
 * whoever is on the page, and the webhook identifies them by the email/phone
 * they typed into Razorpay's form, not by a BestBrain session. So a payment can
 * legitimately arrive for an email that has no account yet. Rather than drop it,
 * the row is stored unlinked and claimed later by `claimForUser` when someone
 * signs up or logs in with that email. See RAZORPAY-SETUP.md for the
 * server-created-subscription route, which removes this ambiguity entirely.
 */

// Razorpay's subscription lifecycle. Kept as their exact strings so a payload
// can be compared against this without translation.
export const SUBSCRIPTION_STATUSES = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "cancelled",
  "completed",
  "expired",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// The statuses that mean "this account should have access right now", provided
// the paid-through date has not passed.
export const ENTITLING_STATUSES: SubscriptionStatus[] = ["active", "authenticated"];

export interface ISubscription extends Document {
  razorpaySubscriptionId: string;
  razorpayCustomerId: string;
  razorpayPlanId: string;

  // Null until an account with a matching email is found. See class docstring.
  userId: mongoose.Types.ObjectId | null;
  email: string;
  contact: string;

  status: SubscriptionStatus;

  // The period the subscriber has paid through. `currentEnd` is what actually
  // decides access — status alone is not enough, because a cancelled
  // subscription is still entitled until the period it already paid for ends.
  currentStart: Date | null;
  currentEnd: Date | null;

  amount: number; // paise
  currency: string;

  // Idempotency. Razorpay retries webhooks, and retries can arrive out of
  // order, so an event is ignored unless it is newer than the last one applied.
  lastEventId: string;
  lastEventAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    // unique: a retried webhook updates the existing row instead of inserting
    // a duplicate that would double-count entitlement.
    razorpaySubscriptionId: { type: String, required: true, unique: true, index: true },
    razorpayCustomerId: { type: String, default: "" },
    razorpayPlanId: { type: String, default: "" },

    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    // Indexed and lowercased because claiming an unlinked payment is a lookup
    // by email, and it must match however the payer typed it.
    email: { type: String, default: "", lowercase: true, trim: true, index: true },
    contact: { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: "created",
    },

    currentStart: { type: Date, default: null },
    currentEnd: { type: Date, default: null },

    amount: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },

    lastEventId: { type: String, default: "" },
    lastEventAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model<ISubscription>(
  "Subscription",
  subscriptionSchema
);

/** True when this row entitles its owner to paid access right now. */
export function isEntitling(sub: Pick<ISubscription, "status" | "currentEnd">): boolean {
  // A cancelled-but-not-yet-expired subscription still has access: the user
  // paid for the period and Razorpay does not refund the remainder. Access is
  // therefore "paid through currentEnd", with status only ruling out the
  // states that never granted access in the first place.
  if (sub.status === "created" || sub.status === "pending") return false;
  if (!sub.currentEnd) return ENTITLING_STATUSES.includes(sub.status);
  return sub.currentEnd.getTime() > Date.now();
}
