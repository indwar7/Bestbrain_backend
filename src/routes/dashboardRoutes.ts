import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getDashboard } from "../controllers/dashboardController";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(getDashboard)); // role-specific dashboard data

export default router;
