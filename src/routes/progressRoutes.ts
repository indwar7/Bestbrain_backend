import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { syncProgress } from "../controllers/progressController";
import { getProgress, saveProgress } from "../controllers/userController";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(getProgress)); // GET  /api/progress       — current snapshot
router.put("/", asyncHandler(saveProgress)); // PUT  /api/progress       — overwrite/merge snapshot
router.post("/sync", asyncHandler(syncProgress)); // POST /api/progress/sync — batched offline events

export default router;
