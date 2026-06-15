import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getMe,
  getProgress,
  saveProgress,
  updateProfile,
} from "../controllers/userController";

const router = Router();

// All user routes require a valid JWT.
router.use(requireAuth);

router.get("/me", getMe);
router.put("/me/profile", updateProfile);
router.get("/me/progress", getProgress);
router.put("/me/progress", saveProgress);

export default router;
