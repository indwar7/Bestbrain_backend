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
import { otpLimiter, authLimiter } from "../middleware/rateLimit";

const router = Router();

// Three separate role-specific signups (rate-limited against abuse).
router.post("/signup/student", authLimiter, signupStudent);
router.post("/signup/teacher", authLimiter, signupTeacher);
router.post("/signup/parent", authLimiter, signupParent);

// Single role-aware login (the frontend sends the chosen role tab).
// Rate-limited to blunt credential-stuffing / brute-force.
router.post("/login", authLimiter, login);

// Email / phone OTP verification (rate-limited; pre-login).
router.post("/send-otp", otpLimiter, requestOtp);
router.post("/verify-otp", otpLimiter, confirmOtp);

router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
