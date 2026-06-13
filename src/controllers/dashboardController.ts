import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User, IUser, IProgress } from "../models/User";

// Derive simple display metrics from a student's progress object.
function studentSummary(user: IUser) {
  const p = user.progress;
  const chapterKeys = Object.keys(p.chapters ?? {});
  const completed = chapterKeys.filter(
    (k) => (p.chapters[k] as Record<string, unknown>)?.completed
  ).length;
  return {
    id: String(user._id),
    name: user.name,
    classLabel: user.classLabel,
    streak: p.streak,
    minutes: p.minutes,
    badges: p.badges,
    chaptersStarted: chapterKeys.length,
    chaptersCompleted: completed,
    lang: p.lang,
  };
}

// GET /api/dashboard — returns role-specific data for the logged-in user.
export async function getDashboard(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // ---------- STUDENT ----------
  if (user.role === "student") {
    res.json({
      role: "student",
      profile: { id: String(user._id), name: user.name, classLabel: user.classLabel },
      stats: studentSummary(user),
      progress: user.progress,
    });
    return;
  }

  // ---------- PARENT ----------
  if (user.role === "parent") {
    const children = await User.find({
      _id: { $in: user.childIds },
      role: "student",
    });
    res.json({
      role: "parent",
      profile: { id: String(user._id), name: user.name },
      children: children.map(studentSummary),
    });
    return;
  }

  // ---------- TEACHER ----------
  if (user.role === "teacher") {
    // Roster = all students whose classLabel matches a class the teacher teaches.
    const roster = await User.find({
      role: "student",
      classLabel: { $in: user.classIds },
    });

    const summaries = roster.map(studentSummary);
    const count = summaries.length || 1;
    const classAverage = {
      avgMinutes: Math.round(
        summaries.reduce((s, x) => s + x.minutes, 0) / count
      ),
      avgStreak: Math.round(
        summaries.reduce((s, x) => s + x.streak, 0) / count
      ),
      avgChaptersCompleted: Math.round(
        summaries.reduce((s, x) => s + x.chaptersCompleted, 0) / count
      ),
    };

    res.json({
      role: "teacher",
      profile: { id: String(user._id), name: user.name, classes: user.classIds },
      studentCount: summaries.length,
      classAverage,
      roster: summaries,
    });
    return;
  }

  res.status(400).json({ error: "Unknown role" });
}
