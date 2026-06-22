import { Router } from "express";
import { listUsers } from "../controllers/adminController";
import { requireAdminKey } from "../middleware/requireAdminKey";

const router = Router();

// Exposes user PII — gated by ADMIN_API_KEY (x-admin-key header / ?adminKey=).
// In production without a key configured, access is denied.
router.get("/users", requireAdminKey, listUsers);

export default router;
