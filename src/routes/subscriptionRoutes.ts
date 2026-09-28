import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdminKey } from "../middleware/requireAdminKey";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getMySubscription,
  getSubscriptionConfig,
  getSubscriptionForUser,
  razorpayWebhook,
} from "../controllers/subscriptionController";

const router = Router();

// Public, the pricing page needs the button id before anyone signs in.
router.get("/config", getSubscriptionConfig);

// Public by necessity: Razorpay has no session with us. Authenticated instead
// by the HMAC signature on every request (see the controller).
router.post("/webhook", asyncHandler(razorpayWebhook));

// There is deliberately NO endpoint for a client to declare itself subscribed.
// Entitlement only ever changes from a signed webhook, a browser cannot prove
// a payment happened, and anything it could send, an attacker could send too.
router.get("/me", requireAuth, asyncHandler(getMySubscription));

router.get("/status/:userId", requireAdminKey, asyncHandler(getSubscriptionForUser));

export default router;
