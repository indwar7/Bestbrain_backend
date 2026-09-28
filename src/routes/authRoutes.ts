import { Router } from "express";
import {
  signupStudent,
  signupTeacher,
  signupParent,
  login,
  refresh,
  logout,
  me,
  relinkChild,
} from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { requestOtp, confirmOtp } from "../controllers/otpController";
import { forgotPassword, resetPassword } from "../controllers/passwordController";
import { otpLimiter, authLimiter } from "../middleware/rateLimit";

const router = Router();

// Three separate role-specific signups (rate-limited against abuse).
router.post("/signup/student", authLimiter, asyncHandler(signupStudent));
router.post("/signup/teacher", authLimiter, asyncHandler(signupTeacher));
router.post("/signup/parent", authLimiter, asyncHandler(signupParent));

// Single role-aware login (the frontend sends the chosen role tab).
// Rate-limited to blunt credential-stuffing / brute-force.
router.post("/login", authLimiter, asyncHandler(login));

// Email / phone OTP verification (rate-limited; pre-login).
router.post("/send-otp", otpLimiter, asyncHandler(requestOtp));
router.post("/verify-otp", otpLimiter, asyncHandler(confirmOtp));

// Password reset: ask for a code, then spend it on a new password. On the OTP
// limiter rather than the auth one, these are code-issuing endpoints, and the
// tighter budget is the point.
router.post("/forgot-password", otpLimiter, asyncHandler(forgotPassword));
router.post("/reset-password", otpLimiter, asyncHandler(resetPassword));

router.post("/refresh", asyncHandler(refresh));
router.post("/logout", asyncHandler(logout));
router.get("/me", requireAuth, asyncHandler(me));
router.post("/relink-child", requireAuth, asyncHandler(relinkChild));

export default router;
