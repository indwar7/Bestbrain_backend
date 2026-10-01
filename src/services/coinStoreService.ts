import crypto from "crypto";
import { env } from "../config/env";
import { CoinPurchase } from "../models/CoinPurchase";
import { awardCoins } from "./coinService";

/** The packs on sale. Bigger packs give more coins per rupee. */
export const COIN_PACKS = [
  { id: "pack_49", coins: 100, amountPaise: 4900, label: "Starter" },
  { id: "pack_99", coins: 250, amountPaise: 9900, label: "Popular" },
  { id: "pack_199", coins: 600, amountPaise: 19900, label: "Best value" },
] as const;

export type CoinPack = (typeof COIN_PACKS)[number];

export function findPack(id: unknown): CoinPack | undefined {
  return COIN_PACKS.find((p) => p.id === id);
}

/** Buying needs the Razorpay API keys; without them the store says so. */
export function storeConfigured(): boolean {
  return env.coinStoreEnabled && !!(env.razorpayKeyId && env.razorpayKeySecret);
}

/** Opens a Razorpay order for one pack (Orders API, server to server). */
export async function createRazorpayOrder(pack: CoinPack, userId: string): Promise<{ id: string }> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: pack.amountPaise,
      currency: "INR",
      receipt: `coins-${userId.slice(-8)}-${Date.now()}`.slice(0, 40),
      notes: { userId, packId: pack.id, purpose: "coins" },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.description || `Razorpay order failed (${res.status})`);
  }
  return { id: data.id };
}

/** Checkout's proof of payment: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!orderId || !paymentId || !signature || !env.razorpayKeySecret) return false;
  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Marks an order paid and credits its coins, once. Safe to call from both the
 * checkout callback and the webhook: the ledger refId makes the second call a
 * no-op that returns the same balance.
 */
export async function fulfilOrder(
  orderId: string,
  paymentId: string
): Promise<{ ok: boolean; coins: number; balance: number; reason?: string }> {
  const purchase = await CoinPurchase.findOne({ razorpayOrderId: orderId });
  if (!purchase) return { ok: false, coins: 0, balance: 0, reason: "unknown order" };
  const result = await awardCoins(
    String(purchase.userId),
    purchase.coins,
    "coins_purchased",
    `purchase:${orderId}`
  );
  if (purchase.status !== "paid") {
    purchase.status = "paid";
    purchase.razorpayPaymentId = paymentId || purchase.razorpayPaymentId;
    purchase.paidAt = new Date();
    await purchase.save();
  }
  return { ok: true, coins: purchase.coins, balance: result.balance };
}
