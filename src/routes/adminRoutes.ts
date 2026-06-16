import { Router } from "express";
import { listUsers } from "../controllers/adminController";

const router = Router();

// Open for the demo so the viewer page can read it without a token.
// (In production this would be protected by an admin role.)
router.get("/users", listUsers);

export default router;
