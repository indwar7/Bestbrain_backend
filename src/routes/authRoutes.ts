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
import { requestOtp, confirmOtp } from "../controllers/otpController";
import { otpLimiter } from "../middleware/rateLimit";

const router = Router();

// Three separate role-specific signups.
router.post("/signup/student", signupStudent);
router.post("/signup/teacher", signupTeacher);
router.post("/signup/parent", signupParent);

// Single role-aware login (the frontend sends the chosen role tab).
router.post("/login", login);

// Email / phone OTP verification (rate-limited; pre-login).
router.post("/send-otp", otpLimiter, requestOtp);
router.post("/verify-otp", otpLimiter, confirmOtp);

router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
