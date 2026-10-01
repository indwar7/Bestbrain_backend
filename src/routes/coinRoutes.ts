import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCoins, spendCoins, listPacks, createCoinOrder, verifyCoinPayment } from "../controllers/coinsController";

const router = Router();

router.use(requireAuth);

// There is no "grant" route on purpose: coins are earned inside the progress
// pipeline, from events the server has already accepted.
router.get("/", asyncHandler(getCoins)); // GET  /api/coins       , balance + history
router.post("/spend", asyncHandler(spendCoins));
router.get("/packs", asyncHandler(listPacks)); // GET  /api/coins/packs  , packs on sale
router.post("/order", asyncHandler(createCoinOrder)); // POST /api/coins/order  , open a Razorpay order
router.post("/verify", asyncHandler(verifyCoinPayment)); // POST /api/coins/verify , checkout callback // POST /api/coins/spend , charge against it

export default router;
