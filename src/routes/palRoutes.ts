import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { chat, getSession } from "../controllers/palController";

const router = Router();

router.use(requireAuth);

router.post("/chat", chat);
router.get("/sessions/:id", getSession);

export default router;
