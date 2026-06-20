import { User, IUser } from "../models/User";
import { getProgressInsights } from "./progressInsights";

// Builds a compact, human-readable summary of a user's REAL learning data so
// PAL can reference it in answers. Returned as plain text that gets appended to
// the role system prompt. Returns "" when there's nothing useful to add.

function countChapters(user: IUser): { started: number; completed: number } {
  const chapters = user.progress.chapters ?? {};
  const keys = Object.keys(chapters);
  const completed = keys.filter(
    (k) => (chapters[k] as Record<string, unknown>)?.completed
  ).length;
  return { started: keys.length, completed };
}

async function studentContextLines(user: IUser, now: Date): Promise<string[]> {
  const p = user.progress;
  const insights = await getProgressInsights(String(user._id), now);
  const { started, completed } = countChapters(user);
  const w = insights.thisWeek;

  return [
    `- Class: ${user.classLabel || user.className || "n/a"}`,
    `- Day streak: ${insights.dayStreak} day(s)${insights.activeToday ? " (active today)" : ""}`,
    `- Total learning time: ${p.minutes} min`,
    `- Chapters: ${completed} completed of ${started} started`,
    `- Badges earned: ${p.badges.length > 0 ? p.badges.join(", ") : "none yet"}`,
    `- This week: ${w.minutes} min, ${w.lessons} lessons, ${w.exercises} exercises, active ${w.activeDays}/7 days`,
  ];
}

export async function buildPalContext(
  userId: string,
  role: "student" | "parent" | "teacher",
  now: Date = new Date()
): Promise<string> {
  const user = await User.findById(userId);
  if (!user) return "";

  // ---------- STUDENT: own data ----------
  if (role === "student") {
    const lines = await studentContextLines(user, now);
    return (
      `Here is ${user.name}'s real EduLearn progress. Reference these specifics ` +
      `when relevant; do not invent numbers.\n${lines.join("\n")}`
    );
  }

  // ---------- PARENT: each linked child ----------
  if (role === "parent") {
    const childIds = user.childLinks.map((l) => l.studentId);
    if (childIds.length === 0) {
      return "This parent has no linked children yet, so no progress data is available.";
    }
    const children = await User.find({ _id: { $in: childIds }, role: "student" });
    const blocks: string[] = [];
    for (const child of children) {
      const lines = await studentContextLines(child, now);
      blocks.push(`Child — ${child.name}:\n${lines.join("\n")}`);
    }
    return (
      `Here is real EduLearn progress for this parent's child/children. ` +
      `Reference these specifics when relevant; do not invent numbers.\n\n` +
      blocks.join("\n\n")
    );
  }

  // ---------- TEACHER: class snapshot ----------
  if (role === "teacher") {
    const classKeys = Array.from(
      new Set(user.teaches.map((t) => `${t.className}||${t.section}`))
    );
    const orFilters = classKeys.map((k) => {
      const [className, section] = k.split("||");
      return { className, section };
    });
    if (orFilters.length === 0) {
      return "This teacher has no assigned classes yet, so no class data is available.";
    }

    const roster = await User.find({ role: "student", $or: orFilters });
    if (roster.length === 0) {
      return "This teacher's classes currently have no enrolled students.";
    }

    const summaries = await Promise.all(
      roster.map(async (s) => {
        const insights = await getProgressInsights(String(s._id), now);
        const { completed } = countChapters(s);
        return {
          name: s.name,
          minutes: s.progress.minutes,
          dayStreak: insights.dayStreak,
          weekMinutes: insights.thisWeek.minutes,
          completed,
          activeThisWeek: insights.thisWeek.activeDays > 0,
        };
      })
    );

    const count = summaries.length;
    const avg = (sel: (s: (typeof summaries)[number]) => number) =>
      Math.round(summaries.reduce((acc, s) => acc + sel(s), 0) / count);
    const activeThisWeek = summaries.filter((s) => s.activeThisWeek).length;
    const ranked = [...summaries].sort((a, b) => b.weekMinutes - a.weekMinutes);
    const top = ranked.slice(0, 3).map((s) => `${s.name} (${s.weekMinutes} min)`);
    const dormant = ranked
      .filter((s) => s.weekMinutes === 0)
      .slice(0, 5)
      .map((s) => s.name);

    const classes = user.teaches
      .map((t) => `${t.className} ${t.section} (${t.subject})`)
      .join(", ");

    return [
      `Here is a real snapshot of ${user.name}'s class(es). Reference these ` +
        `specifics when relevant; do not invent numbers.`,
      `- Classes taught: ${classes}`,
      `- Students: ${count} total, ${activeThisWeek} active this week`,
      `- Class averages: ${avg((s) => s.minutes)} min total, ${avg((s) => s.dayStreak)} day streak, ${avg((s) => s.weekMinutes)} min this week, ${avg((s) => s.completed)} chapters completed`,
      `- Most engaged this week: ${top.length ? top.join(", ") : "n/a"}`,
      `- Inactive this week: ${dormant.length ? dormant.join(", ") : "none"}`,
    ].join("\n");
  }

  return "";
}
