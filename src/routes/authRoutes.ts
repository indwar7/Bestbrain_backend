import { Router } from "express";
import {
  signupStudent,
  signupTeacher,
  signupParent,
  login,
  refresh,
  logout,
  me,
} from "../controllers/authController";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Three separate role-specific signups.
router.post("/signup/student", signupStudent);
router.post("/signup/teacher", signupTeacher);
router.post("/signup/parent", signupParent);

// Single role-aware login (the frontend sends the chosen role tab).
router.post("/login", login);

router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
