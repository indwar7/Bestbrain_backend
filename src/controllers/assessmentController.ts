import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { Question, IQuestion } from "../models/Question";
import { MockAttempt } from "../models/MockAttempt";
import { ChallengeAttempt } from "../models/ChallengeAttempt";
import { awardCoins } from "../services/coinService";

// What one first-correct bank answer is worth. Small on purpose: practice
// should be worth doing, not worth farming.
const BANK_COINS_PER_FIRST_CORRECT = 1;

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
  const { className, subject, chapterSlug, usage } = req.query as {
    className?: string;
    subject?: string;
    chapterSlug?: string;
    usage?: string;
  };
  const filter: Record<string, unknown> = {};
  if (className) filter.className = className;
  if (subject) filter.subject = subject;
  // Assigning homework is a per-chapter job, and without these a teacher had
  // to page through every question for the class to find the ten they wanted.
  if (chapterSlug) filter.chapterSlug = chapterSlug;
  if (["mock", "challenge", "bank", "both"].includes(String(usage))) filter.usage = usage;
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

// POST /api/assessments/mock/:attemptId/answer  Body: { index, chosenIndex }
// Grades ONE question mid-test so the student can read the worked solution before
// moving on. The correct answer never reaches the browser until the student has
// committed to a choice, so the paper can't be read ahead from devtools.
export async function answerMockQuestion(req: AuthRequest, res: Response): Promise<void> {
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

  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0 || index >= attempt.questionIds.length) {
    res.status(400).json({ error: "index is out of range for this attempt" });
    return;
  }

  const q = await Question.findById(attempt.questionIds[index]);
  if (!q) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  // Record the choice as we go so a dropped connection doesn't lose the attempt.
  // Once revealed, the answer is locked — you can't read the solution and then
  // change your mind. Repeating the same call is idempotent (safe on retry).
  if (!attempt.revealed.includes(index)) {
    const raw = Number(req.body?.chosenIndex);
    const chosen =
      Number.isInteger(raw) && raw >= 0 && raw < q.options.length ? raw : -1;
    attempt.answers[index] = chosen;
    attempt.markModified("answers");
    attempt.revealed.push(index);
    await attempt.save();
  }

  const chosen = attempt.answers[index] ?? -1;
  res.json({
    chosen,
    correct: chosen === q.correctIndex,
    correctIndex: q.correctIndex,
    explanation: q.explanation || "",
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
    // A question answered one-at-a-time (see answerMockQuestion) is already
    // locked server-side — trust that over whatever the client posts now.
    const chosen = attempt.revealed.includes(i)
      ? attempt.answers[i]
      : Number(answers[i]);
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

// POST /api/assessments/mock/record  Body: { subject, testName?, score, total, mastery? }
// Persists a COMPLETED attempt from the client-side adaptive test engine. That
// engine runs entirely in the browser with its own question bank, so there's no
// server-side attempt to grade via submitMock — we just record the result so it
// survives re-login, syncs across devices, and is visible server-side.
export async function recordMockAttempt(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can record test attempts" });
    return;
  }
  const b = (req.body || {}) as {
    subject?: string; testName?: string; score?: number; total?: number; mastery?: number;
  };
  const subject = String(b.subject || "").trim().slice(0, 60);
  const total = Math.max(0, Math.round(Number(b.total) || 0));
  const score = Math.max(0, Math.min(total, Math.round(Number(b.score) || 0)));
  if (!subject || total <= 0) {
    res.status(400).json({ error: "subject and a positive total are required" });
    return;
  }
  const mastery =
    b.mastery === undefined || b.mastery === null
      ? Math.round((score / total) * 100)
      : Math.max(0, Math.min(100, Math.round(Number(b.mastery) || 0)));

  const attempt = await MockAttempt.create({
    userId: user._id,
    className: user.className,
    subject,
    testName: String(b.testName || subject).slice(0, 120),
    total,
    score,
    mastery,
    finished: true,
    finishedAt: new Date(),
  });

  res.status(201).json({
    attempt: {
      id: String(attempt._id),
      subject: attempt.subject,
      testName: attempt.testName,
      score: attempt.score,
      total: attempt.total,
      mastery: attempt.mastery,
      finishedAt: attempt.finishedAt,
    },
  });
}

// GET /api/assessments/mock/history — the student's past attempts.
export async function mockHistory(req: AuthRequest, res: Response): Promise<void> {
  const attempts = await MockAttempt.find({ userId: req.user!.id, finished: true })
    .select("subject testName score total mastery finishedAt")
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
  // class sees the same one (stable across requests within the hour). The arena
  // is a Science drop, so prefer Science questions; only if a class has none do
  // we fall back to its full challenge pool rather than dead-ending on a 404.
  const baseMatch: Record<string, unknown> = {
    className: user.className,
    usage: { $in: ["challenge", "both"] },
  };
  const select = "_id text options difficulty subject chapterSlug";
  let pool = await Question.find({ ...baseMatch, subject: "Science" })
    .select(select)
    .sort({ _id: 1 });
  if (pool.length === 0) {
    pool = await Question.find(baseMatch).select(select).sort({ _id: 1 });
  }

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

// ===========================================================================
// QUESTION BANK
//
// Chapter practice, not a test. There is no clock, no attempt row and no score
// kept: a student opens a chapter, answers, is told immediately whether they
// were right and why, and can keep going for as long as they like. That is the
// whole difference from a mock test, and it is why nothing here writes an
// attempt record.
//
// Coins are paid on the FIRST correct answer to each question and never again,
// so drilling the same chapter twice is worth doing and worth nothing extra.
// The ledger's unique refId is what holds that — see awardCoins.
// ===========================================================================

// A question is available to the bank if it was authored for the bank, or for
// anything ("both"). Mock- and challenge-only questions stay out, so a teacher
// can keep exam material out of open practice.
const BANK_USAGE = { $in: ["bank", "both"] };

// GET /api/assessments/bank?subject=&chapterSlug=&count=&difficulty=
// Student only. Serves questions for the student's OWN class — className is
// taken from the account, never from the query, so a Class 6 student cannot
// ask for Class 9 material.
export async function getBank(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can practise the question bank" });
    return;
  }

  const { subject, chapterSlug, difficulty } = req.query as {
    subject?: string;
    chapterSlug?: string;
    difficulty?: string;
  };
  if (!subject) {
    res.status(400).json({ error: "subject is required" });
    return;
  }
  const count = Math.min(Math.max(Number(req.query.count) || 10, 1), 50);

  const match: Record<string, unknown> = {
    className: user.className,
    subject,
    usage: BANK_USAGE,
  };
  if (chapterSlug) match.chapterSlug = chapterSlug;
  if (["easy", "medium", "hard"].includes(String(difficulty))) match.difficulty = difficulty;

  // Sampled rather than sorted: coming back to a chapter should not deal the
  // same ten questions in the same order every time.
  const picked = await Question.aggregate([{ $match: match }, { $sample: { size: count } }]);

  res.json({
    className: user.className,
    subject,
    chapterSlug: chapterSlug || "",
    total: picked.length,
    questions: picked.map((q) => publicQuestion(q as IQuestion)),
  });
}

// POST /api/assessments/bank/answer   Body: { questionId, chosenIndex }
// Grades one answer and returns the solution WITH its explanation — the point
// of the bank is to learn the thing immediately, not at the end of a paper.
export async function answerBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can practise the question bank" });
    return;
  }

  const { questionId } = req.body as { questionId?: string };
  const chosenIndex = Number((req.body as { chosenIndex?: number }).chosenIndex);
  if (!questionId || !mongoose.isValidObjectId(questionId)) {
    res.status(400).json({ error: "A valid questionId is required" });
    return;
  }
  if (!Number.isInteger(chosenIndex) || chosenIndex < 0) {
    res.status(400).json({ error: "chosenIndex must be an option index" });
    return;
  }

  const q = await Question.findById(questionId);
  if (!q) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  // Same guard as serving: a student may only be graded on their own class's
  // questions, so a guessed id from another class is refused rather than
  // answered — which would also leak that question's correctIndex.
  if (q.className !== user.className) {
    res.status(403).json({ error: "That question is not for your class" });
    return;
  }
  if (chosenIndex >= q.options.length) {
    res.status(400).json({ error: "chosenIndex must be an option index" });
    return;
  }

  const correct = chosenIndex === q.correctIndex;
  let coins = { awarded: false, balance: user.progress?.coins ?? 0 };
  if (correct) {
    coins = await awardCoins(
      String(user._id),
      BANK_COINS_PER_FIRST_CORRECT,
      "bank_correct",
      `bank:${String(q._id)}`
    );
  }

  res.json({
    correct,
    correctIndex: q.correctIndex,
    explanation: q.explanation || "",
    coinsAwarded: coins.awarded ? BANK_COINS_PER_FIRST_CORRECT : 0,
    balance: coins.balance,
  });
}

// GET /api/assessments/bank/chapters?subject=
// How many bank questions each chapter has, so Learn can show a count and hide
// the module on chapters with nothing in them yet.
export async function bankChapterCounts(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const { subject } = req.query as { subject?: string };
  if (!subject) {
    res.status(400).json({ error: "subject is required" });
    return;
  }

  const rows = await Question.aggregate([
    { $match: { className: user.className, subject, usage: BANK_USAGE } },
    { $group: { _id: "$chapterSlug", count: { $sum: 1 } } },
  ]);

  const chapters: Record<string, number> = {};
  for (const r of rows) chapters[String(r._id || "")] = r.count as number;
  res.json({ className: user.className, subject, chapters });
}
