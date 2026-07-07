import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { Question, IQuestion } from "../models/Question";
import { MockAttempt } from "../models/MockAttempt";
import { ChallengeAttempt } from "../models/ChallengeAttempt";

// Strip the answer before sending a question to a student.
function publicQuestion(q: IQuestion) {
  return {
    id: String(q._id),
    text: q.text,
    options: q.options,
    difficulty: q.difficulty,
    subject: q.subject,
    chapterSlug: q.chapterSlug || "",
  };
}

// The current UTC hour key, e.g. "2026-06-23T09".
function hourKey(d: Date): string {
  return d.toISOString().slice(0, 13);
}

// ===========================================================================
// AUTHORING (teacher/admin)
// ===========================================================================

// POST /api/assessments/questions  (teacher/admin)
// Body: { className, subject, text, options[], correctIndex, explanation?,
//         difficulty?, usage?, chapterSlug? }
export async function createQuestion(req: AuthRequest, res: Response): Promise<void> {
  const b = req.body as Record<string, unknown>;
  const options = Array.isArray(b.options) ? (b.options as string[]) : [];
  const correctIndex = Number(b.correctIndex);

  if (!b.className || !b.subject || !b.text || options.length < 2) {
    res.status(400).json({ error: "className, subject, text and 2+ options are required" });
    return;
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    res.status(400).json({ error: "correctIndex must point at one of the options" });
    return;
  }

  const difficulty = (["easy", "medium", "hard"].includes(b.difficulty as string)
    ? b.difficulty
    : "medium") as IQuestion["difficulty"];
  const usage = (["mock", "challenge", "both"].includes(b.usage as string)
    ? b.usage
    : "both") as IQuestion["usage"];

  const q = await Question.create({
    className: String(b.className),
    subject: String(b.subject),
    chapterSlug: typeof b.chapterSlug === "string" ? b.chapterSlug : "",
    text: String(b.text),
    options,
    correctIndex,
    explanation: typeof b.explanation === "string" ? b.explanation : "",
    difficulty,
    usage,
    createdById: req.user?.id,
    createdByRole: req.user?.role === "teacher" ? "teacher" : "admin",
  });

  res.status(201).json({ id: String(q._id) });
}

// GET /api/assessments/questions?className=&subject=  (teacher/admin)
// Includes the answer so authors can review their bank.
export async function listQuestions(req: AuthRequest, res: Response): Promise<void> {
  const { className, subject } = req.query as { className?: string; subject?: string };
  const filter: Record<string, unknown> = {};
  if (className) filter.className = className;
  if (subject) filter.subject = subject;
  const questions = await Question.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ total: questions.length, questions });
}

// ===========================================================================
// MOCK TESTS
// ===========================================================================

// POST /api/assessments/mock/start   Body: { subject, chapterSlug?, count? }
// Serves a fresh set of questions for the student's class+subject (optionally
// narrowed to one chapter, e.g. from a teacher's shared-test link) and opens
// an attempt. Answers are NOT included.
export async function startMock(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can take mock tests" });
    return;
  }
  const { subject, chapterSlug } = req.body as { subject?: string; chapterSlug?: string };
  const count = Math.min(Math.max(Number((req.body as { count?: number }).count) || 10, 1), 50);
  if (!subject) {
    res.status(400).json({ error: "subject is required" });
    return;
  }

  const match: Record<string, unknown> = {
    className: user.className,
    subject,
    usage: { $in: ["mock", "both"] },
  };
  if (chapterSlug) match.chapterSlug = chapterSlug;

  let pool = await Question.aggregate([{ $match: match }, { $sample: { size: count } }]);

  // A shared chapter link with no matching questions yet shouldn't dead-end —
  // fall back to the subject's general pool rather than a bare 404.
  if (pool.length === 0 && chapterSlug) {
    delete match.chapterSlug;
    pool = await Question.aggregate([{ $match: match }, { $sample: { size: count } }]);
  }

  if (pool.length === 0) {
    res.status(404).json({ error: "No questions available for this class and subject yet" });
    return;
  }

  const attempt = await MockAttempt.create({
    userId: user._id,
    className: user.className,
    subject,
    questionIds: pool.map((q) => q._id),
    answers: new Array(pool.length).fill(-1),
    total: pool.length,
  });

  res.status(201).json({
    attemptId: String(attempt._id),
    total: pool.length,
    questions: pool.map((q) => publicQuestion(q as IQuestion)),
  });
}

// POST /api/assessments/mock/:attemptId/submit  Body: { answers: number[] }
// Grades the attempt server-side and returns the score + per-question review.
export async function submitMock(req: AuthRequest, res: Response): Promise<void> {
  const attempt = await MockAttempt.findOne({
    _id: req.params.attemptId,
    userId: req.user!.id,
  });
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }
  if (attempt.finished) {
    res.status(409).json({ error: "This attempt was already submitted" });
    return;
  }

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const questions = await Question.find({ _id: { $in: attempt.questionIds } });
  const byId = new Map(questions.map((q) => [String(q._id), q]));

  let score = 0;
  const review = attempt.questionIds.map((qid, i) => {
    const q = byId.get(String(qid));
    const chosen = Number(answers[i]);
    const isCorrect = !!q && chosen === q.correctIndex;
    if (isCorrect) score += 1;
    return {
      questionId: String(qid),
      chosen: Number.isInteger(chosen) ? chosen : -1,
      correctIndex: q?.correctIndex ?? -1,
      correct: isCorrect,
      explanation: q?.explanation || "",
    };
  });

  attempt.answers = review.map((r) => r.chosen);
  attempt.score = score;
  attempt.finished = true;
  attempt.finishedAt = new Date();
  await attempt.save();

  res.json({ score, total: attempt.total, review });
}

// GET /api/assessments/mock/history — the student's past attempts.
export async function mockHistory(req: AuthRequest, res: Response): Promise<void> {
  const attempts = await MockAttempt.find({ userId: req.user!.id, finished: true })
    .select("subject score total finishedAt")
    .sort({ finishedAt: -1 })
    .limit(50)
    .lean();
  res.json({ attempts });
}

// ===========================================================================
// HOURLY CHALLENGE
// ===========================================================================

// GET /api/assessments/challenge — the current hour's question (one per hour,
// shared by everyone in the student's class). Answer stripped.
export async function getChallenge(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can play the challenge" });
    return;
  }
  const key = hourKey(new Date());

  // Already played this hour?
  const existing = await ChallengeAttempt.findOne({ userId: user._id, hourKey: key });
  if (existing) {
    res.json({ alreadyPlayed: true, hourKey: key, points: existing.points });
    return;
  }

  // Deterministically pick one question for this class+hour so everyone in the
  // class sees the same one (stable across requests within the hour).
  const pool = await Question.find({
    className: user.className,
    usage: { $in: ["challenge", "both"] },
  })
    .select("_id text options difficulty subject chapterSlug")
    .sort({ _id: 1 });

  if (pool.length === 0) {
    res.status(404).json({ error: "No challenge question available yet" });
    return;
  }

  // Hash the hour key to an index — same hour → same question.
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const q = pool[h % pool.length];

  res.json({
    alreadyPlayed: false,
    hourKey: key,
    question: publicQuestion(q as IQuestion),
  });
}

// POST /api/assessments/challenge/answer  Body: { questionId, chosenIndex, msTaken }
// Scores the answer (correct + speed bonus), enforces one attempt per hour.
export async function answerChallenge(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can play the challenge" });
    return;
  }
  const { questionId, chosenIndex, msTaken } = req.body as {
    questionId?: string;
    chosenIndex?: number;
    msTaken?: number;
  };
  if (!questionId || !mongoose.isValidObjectId(questionId) || chosenIndex === undefined) {
    res.status(400).json({ error: "questionId and chosenIndex are required" });
    return;
  }

  const q = await Question.findById(questionId);
  if (!q) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  const key = hourKey(new Date());
  const correct = Number(chosenIndex) === q.correctIndex;
  const ms = Math.max(0, Number(msTaken) || 0);
  // Speed bonus: full 50 within 2s, decaying to 0 by 45s. Base 50 for correct.
  const speedBonus = correct ? Math.max(0, Math.round(50 - (ms / 45000) * 50)) : 0;
  const points = correct ? 50 + speedBonus : 0;

  try {
    const attempt = await ChallengeAttempt.create({
      userId: user._id,
      userName: user.name,
      hourKey: key,
      questionId: q._id,
      chosenIndex: Number(chosenIndex),
      correct,
      msTaken: ms,
      points,
    });
    res.json({
      correct,
      points: attempt.points,
      correctIndex: q.correctIndex,
      explanation: q.explanation || "",
    });
  } catch (err: unknown) {
    // Duplicate key = already played this hour.
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ error: "You've already played this hour" });
      return;
    }
    throw err;
  }
}

// GET /api/assessments/challenge/leaderboard — top scorers for the current hour.
export async function challengeLeaderboard(req: AuthRequest, res: Response): Promise<void> {
  const key = hourKey(new Date());
  const top = await ChallengeAttempt.find({ hourKey: key })
    .select("userName points msTaken correct")
    .sort({ points: -1, msTaken: 1 })
    .limit(20)
    .lean();

  const me = await ChallengeAttempt.findOne({
    userId: req.user!.id,
    hourKey: key,
  }).lean();

  res.json({
    hourKey: key,
    leaderboard: top.map((a, i) => ({
      rank: i + 1,
      name: a.userName,
      points: a.points,
    })),
    you: me ? { points: me.points, correct: me.correct } : null,
  });
}
