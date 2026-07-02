import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getMe,
  getProgress,
  saveProgress,
  updateProfile,
} from "../controllers/userController";

const router = Router();

// All user routes require a valid JWT.
router.use(requireAuth);

router.get("/me", asyncHandler(getMe));
router.put("/me/profile", asyncHandler(updateProfile));
router.get("/me/progress", asyncHandler(getProgress));
router.put("/me/progress", asyncHandler(saveProgress));

export default router;
