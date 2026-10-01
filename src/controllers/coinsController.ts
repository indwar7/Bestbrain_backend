import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { CoinLedger } from "../models/CoinLedger";
import { spendCoins as spendCoinsService } from "../services/coinService";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { CoinPurchase } from "../models/CoinPurchase";
import {
  COIN_PACKS,
  findPack,
  storeConfigured,
  createRazorpayOrder,
  verifyCheckoutSignature,
  fulfilOrder,
} from "../services/coinStoreService";

// Coins are earned inside the progress pipeline (see progressController) ,
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

// GET /api/coins/packs, what is on sale and whether buying is switched on.
export async function listPacks(_req: AuthRequest, res: Response): Promise<void> {
  res.json({
    enabled: storeConfigured(),
    packs: COIN_PACKS.map((p) => ({ id: p.id, coins: p.coins, price: p.amountPaise / 100, label: p.label })),
  });
}

// POST /api/coins/order   Body: { packId }   (students)
// Opens a Razorpay order; the browser then runs Razorpay Checkout with it.
export async function createCoinOrder(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id).select("role name email phone");
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can buy coins" });
    return;
  }
  const pack = findPack((req.body as { packId?: string }).packId);
  if (!pack) {
    res.status(400).json({ error: "Choose a coin pack" });
    return;
  }
  if (!storeConfigured()) {
    res.status(503).json({ error: "Buying coins is not switched on yet", code: "store_not_configured" });
    return;
  }
  let order;
  try {
    order = await createRazorpayOrder(pack, String(user._id));
  } catch (err) {
    logger.error({ err }, "[coins] could not open a Razorpay order");
    res.status(502).json({ error: "Could not start the payment. Please try again." });
    return;
  }
  await CoinPurchase.create({
    userId: user._id,
    packId: pack.id,
    coins: pack.coins,
    amountPaise: pack.amountPaise,
    razorpayOrderId: order.id,
  });
  res.status(201).json({
    orderId: order.id,
    amount: pack.amountPaise,
    currency: "INR",
    keyId: env.razorpayKeyId,
    coins: pack.coins,
    name: "BestBrain",
    description: `${pack.coins} coins`,
    prefill: { name: user.name, email: user.email, contact: user.phone || "" },
  });
}

// POST /api/coins/verify   Body: { orderId, paymentId, signature }
// Checkout's success callback. The signature is the proof; the order must be
// this student's own.
export async function verifyCoinPayment(req: AuthRequest, res: Response): Promise<void> {
  const { orderId, paymentId, signature } = req.body as Record<string, string>;
  const purchase = orderId ? await CoinPurchase.findOne({ razorpayOrderId: orderId }) : null;
  if (!purchase || String(purchase.userId) !== req.user!.id) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!verifyCheckoutSignature(String(orderId), String(paymentId), String(signature))) {
    res.status(400).json({ error: "Payment could not be verified" });
    return;
  }
  const result = await fulfilOrder(String(orderId), String(paymentId));
  res.json({ ok: true, coins: result.coins, balance: result.balance });
}
