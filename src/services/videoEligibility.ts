import { IUser } from "../models/User";
import { IVideo } from "../models/Video";

export interface EligibilityResult {
  allowed: boolean;
  reason?: string;
}

// Class is stored inconsistently across callers ("Class 7", "7", 7), compare
// by the digits only so a comparison from either shape still matches.
function classDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function normalizeSubject(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

// Decides whether a user may watch/stream a given lecture video.
// Rules:
//  - The teacher who uploaded it can always watch it.
//  - Any other teacher may watch it (lecture content is shared across the
//    teaching staff, unlike live classes which are one teacher's session).
//  - A student may watch it only if it matches their own class AND they take
//    the subject (mirrors the live-class eligibility rule).
//  - A parent may watch it if ANY of their linked children would be eligible.
export function canViewVideo(
  user: Pick<IUser, "role" | "className" | "subjects"> & { _id: unknown },
  video: Pick<IVideo, "uploadedById" | "className" | "subject">,
  children?: Pick<IUser, "className" | "subjects">[]
): EligibilityResult {
  if (user.role === "teacher") {
    return { allowed: true };
  }

  if (user.role === "student") {
    if (classDigits(user.className) !== classDigits(video.className)) {
      return { allowed: false, reason: "This lecture isn't for your class" };
    }
    if (!user.subjects?.some((s) => normalizeSubject(s) === normalizeSubject(video.subject))) {
      return { allowed: false, reason: `You don't take ${video.subject}` };
    }
    return { allowed: true };
  }

  if (user.role === "parent") {
    const eligible = (children ?? []).some(
      (c) =>
        classDigits(c.className) === classDigits(video.className) &&
        c.subjects?.some((s) => normalizeSubject(s) === normalizeSubject(video.subject))
    );
    return eligible
      ? { allowed: true }
      : { allowed: false, reason: "None of your linked children take this class/subject" };
  }

  return { allowed: false, reason: "Not eligible to view this lecture" };
}
