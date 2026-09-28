import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { env } from "../config/env";
import { logger, captureException } from "../config/logger";
import {
  applyWebhookEvent,
  claimForUser,
  getEntitlement,
  verifyWebhookSignature,
} from "../services/subscriptionService";

// Express doesn't type the raw-body stash app.ts adds; declare it once here.
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// GET /api/subscription/config
// Public. Lets the pricing page render without the button id or the price being
// baked into the frontend bundle, changing the plan then means changing env
// vars and restarting, not rebuilding and redeploying the site.
export function getSubscriptionConfig(_req: Request, res: Response): void {
  res.json({
    subscriptionButtonId: env.razorpaySubscriptionButtonId,
    pricePaise: env.subscriptionPricePaise,
    currency: env.subscriptionCurrency,
    // So the UI can warn instead of silently taking money it can never honour.
    webhookConfigured: env.razorpayWebhookConfigured,
  });
}

// GET /api/subscription/me
// The signed-in user's entitlement. Read from the Subscription rows rather than
// the denormalised user flag, so it is correct even if a snapshot write was
// missed, and `claimForUser` runs first so a payment made before signup is
// picked up the first time they ask.
export async function getMySubscription(req: AuthRequest, res: Response): Promise<void> {
  const entitlement = await claimForUser({
    id: req.user!.id,
    email: req.user!.email,
  });

  res.json({
    active: entitlement.active,
    status: entitlement.status,
    paidThrough: entitlement.paidThrough,
    subscriptionId: entitlement.razorpaySubscriptionId,
  });
}

// POST /api/subscription/webhook
// Razorpay -> us. Public by necessity (Razorpay cannot hold a session), so the
// HMAC signature is the ONLY thing standing between this endpoint and anyone
// granting themselves a paid account. Never relax it.
export async function razorpayWebhook(req: RawBodyRequest, res: Response): Promise<void> {
  const signature = String(req.headers["x-razorpay-signature"] ?? "");
  const eventId = String(req.headers["x-razorpay-event-id"] ?? "");
  const raw = req.rawBody;

  if (!env.razorpayWebhookConfigured) {
    // Refusing is deliberate. Accepting unverifiable events would mean any
    // POST to this URL could activate a subscription.
    logger.error("[subscription] webhook received but RAZORPAY_WEBHOOK_SECRET is unset, rejecting");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  if (!raw) {
    // app.ts must stash the raw buffer; without it the HMAC cannot be checked.
    logger.error("[subscription] webhook raw body missing, check express.json verify hook in app.ts");
    res.status(500).json({ error: "Raw body unavailable" });
    return;
  }

  if (!verifyWebhookSignature(raw, signature)) {
    logger.warn({ eventId }, "[subscription] webhook signature rejected");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    const result = await applyWebhookEvent(req.body, eventId);
    logger.info({ eventId, ...result }, "[subscription] webhook applied");
    // Always 200 once the signature is good. A non-2xx makes Razorpay retry,
    // and retrying will not fix a payload we simply do not handle.
    res.json({ ok: true, handled: result.handled });
  } catch (err) {
    captureException(err, { scope: "razorpay-webhook", eventId });
    // A 500 here IS worth a retry, the event was genuine and we failed to
    // record it, so we want Razorpay to send it again.
    res.status(500).json({ error: "Could not process event" });
  }
}

// GET /api/subscription/status/:userId, admin-only sanity check.
// Guarded by requireAdminKey at the route level.
export async function getSubscriptionForUser(req: Request, res: Response): Promise<void> {
  const entitlement = await getEntitlement(String(req.params.userId));
  res.json(entitlement);
}
