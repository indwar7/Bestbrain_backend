import { IUser } from "../models/User";
import { ILiveSession } from "../models/LiveSession";

export interface EligibilityResult {
  allowed: boolean;
  reason?: string;
}

// Decides whether a user may join a given live session.
// Rules:
//  - The teacher who owns the session can always join.
//  - A student must match the session's class AND section, and take the subject.
//  - Parents/other teachers cannot join.
export function canJoinSession(
  user: Pick<IUser, "role" | "className" | "section" | "subjects"> & { _id: unknown },
  session: Pick<ILiveSession, "teacherId" | "className" | "section" | "subject" | "status">
): EligibilityResult {
  if (session.status === "ended") {
    return { allowed: false, reason: "This session has ended" };
  }

  // Owning teacher
  if (
    user.role === "teacher" &&
    String((session.teacherId as unknown) ?? "") === String(user._id)
  ) {
    return { allowed: true };
  }

  if (user.role !== "student") {
    return { allowed: false, reason: "Only enrolled students can join this class" };
  }

  if (user.className !== session.className) {
    return { allowed: false, reason: "You are not in this class" };
  }
  if (user.section !== session.section) {
    return { allowed: false, reason: "You are not in this section" };
  }
  if (!user.subjects?.includes(session.subject)) {
    return { allowed: false, reason: `You don't take ${session.subject}` };
  }

  return { allowed: true };
}
