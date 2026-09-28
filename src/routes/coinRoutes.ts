import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getCoins, spendCoins } from "../controllers/coinsController";

const router = Router();

router.use(requireAuth);

// There is no "grant" route on purpose: coins are earned inside the progress
// pipeline, from events the server has already accepted.
router.get("/", asyncHandler(getCoins)); // GET  /api/coins       , balance + history
router.post("/spend", asyncHandler(spendCoins)); // POST /api/coins/spend , charge against it

export default router;
