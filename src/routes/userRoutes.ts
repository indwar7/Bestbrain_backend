import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getMe, getProgress, saveProgress } from "../controllers/userController";

const router = Router();

// All user routes require a valid JWT.
router.use(requireAuth);

router.get("/me", getMe);
router.get("/me/progress", getProgress);
router.put("/me/progress", saveProgress);

export default router;
