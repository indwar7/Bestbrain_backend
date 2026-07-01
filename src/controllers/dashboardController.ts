import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { User, IUser } from "../models/User";
import { getProgressInsights, ProgressInsights } from "../services/progressInsights";
import { getMasteryInsights } from "../services/masteryInsights";

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

// A student summary enriched with derived insights (real day-streak, weekly
// activity, this-week totals) from the ProgressEvent log.
async function studentSummaryWithInsights(user: IUser, now: Date) {
  const base = studentSummary(user);
  const insights = await getProgressInsights(String(user._id), now);
  return {
    ...base,
    dayStreak: insights.dayStreak, // real consecutive-day streak
    activeToday: insights.activeToday,
    weekly: insights.weekly,
    thisWeek: insights.thisWeek,
    lastActiveAt: insights.lastActiveAt,
  };
}

// GET /api/dashboard — returns role-specific data for the logged-in user.
export async function getDashboard(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const now = new Date();

  // ---------- STUDENT ----------
  if (user.role === "student") {
    const [insights, mastery] = await Promise.all([
      getProgressInsights(String(user._id), now),
      getMasteryInsights(user),
    ]);
    res.json({
      role: "student",
      profile: { id: String(user._id), name: user.name, classLabel: user.classLabel },
      stats: studentSummary(user), // legacy shape (kept for the existing UI)
      insights, // real day-streak, weekly activity, this-week totals
      mastery, // real per-subject mastery + earned badges (empty if none)
      progress: user.progress,
    });
    return;
  }

  // ---------- PARENT ----------
  if (user.role === "parent") {
    const childIds = user.childLinks.map((l) => l.studentId);
    const children = await User.find({
      _id: { $in: childIds },
      role: "student",
    });
    // Each child gets its real streak + weekly activity + mastery for the parent view.
    const enriched = await Promise.all(
      children.map(async (c) => ({
        ...(await studentSummaryWithInsights(c, now)),
        mastery: await getMasteryInsights(c),
      }))
    );
    res.json({
      role: "parent",
      profile: { id: String(user._id), name: user.name },
      children: enriched,
    });
    return;
  }

  // ---------- TEACHER ----------
  if (user.role === "teacher") {
    // Distinct class+section pairs this teacher is assigned to.
    const classKeys = Array.from(
      new Set(user.teaches.map((t) => `${t.className}||${t.section}`))
    );
    const orFilters = classKeys.map((k) => {
      const [className, section] = k.split("||");
      return { className, section };
    });

    // Roster = all students in any class+section the teacher teaches.
    const roster =
      orFilters.length > 0
        ? await User.find({ role: "student", $or: orFilters })
        : [];

    // Enrich every student with real streak + weekly activity.
    const summaries = await Promise.all(
      roster.map((s) => studentSummaryWithInsights(s, now))
    );
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
      // Real (event-derived) averages.
      avgDayStreak: Math.round(
        summaries.reduce((s, x) => s + x.dayStreak, 0) / count
      ),
      avgWeekMinutes: Math.round(
        summaries.reduce((s, x) => s + x.thisWeek.minutes, 0) / count
      ),
    };

    // How many were active in the last 7 days vs. dormant — useful at a glance.
    const activeThisWeek = summaries.filter((s) => s.thisWeek.activeDays > 0).length;

    // Most engaged + needs-attention (by this-week minutes).
    const byWeekMinutes = [...summaries].sort(
      (a, b) => b.thisWeek.minutes - a.thisWeek.minutes
    );
    const topStudents = byWeekMinutes.slice(0, 3);
    const needsAttention = byWeekMinutes
      .filter((s) => s.thisWeek.minutes === 0)
      .slice(0, 5);

    res.json({
      role: "teacher",
      profile: { id: String(user._id), name: user.name, teaches: user.teaches },
      studentCount: summaries.length,
      activeThisWeek,
      classAverage,
      topStudents,
      needsAttention,
      roster: summaries,
    });
    return;
  }

  res.status(400).json({ error: "Unknown role" });
}
