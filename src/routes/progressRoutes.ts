import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { syncProgress } from "../controllers/progressController";
import { getProgress, saveProgress } from "../controllers/userController";

const router = Router();

router.use(requireAuth);

router.get("/", getProgress); // GET  /api/progress       — current snapshot
router.put("/", saveProgress); // PUT  /api/progress       — overwrite/merge snapshot
router.post("/sync", syncProgress); // POST /api/progress/sync — batched offline events

export default router;
