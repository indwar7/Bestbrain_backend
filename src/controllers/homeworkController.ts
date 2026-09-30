import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth";
import { User } from "../models/User";
import { Question, IQuestion } from "../models/Question";
import { Homework } from "../models/Homework";
import { HomeworkSubmission } from "../models/HomeworkSubmission";
import { HomeworkUpload, IHomeworkUpload } from "../models/HomeworkUpload";
import fs from "fs";
import path from "path";

export const HOMEWORK_UPLOAD_DIR = path.join(process.cwd(), "uploads", "homework");

// Written questions: plain strings, trimmed, blanks dropped, at most 10.
function cleanWritten(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
}

type UploadLike = Pick<IHomeworkUpload, "originalName" | "mimeType" | "size" | "uploadedAt">;
function uploadView(u: UploadLike | null | undefined) {
  if (!u) return null;
  return { originalName: u.originalName, mimeType: u.mimeType, size: u.size, uploadedAt: u.uploadedAt };
}

/**
 * Homework: a teacher hands out a set of questions with a date on it, and a
 * student answers them once.
 *
 * The rule that shapes almost everything here is that a student's className
 * comes from their own account and never from the request. It is the only
 * thing standing between "list my homework" and "list Class 9's homework", and
 * it has to hold on every route a student can reach, listing, opening, and
 * submitting alike, because each of those would otherwise leak the questions
 * or the answers of a class the student is not in.
 *
 * The other invariant is the one this codebase already keeps for mock tests:
 * correctIndex never travels to a student before they have answered. The
 * student-facing read strips it; only the submit response carries solutions,
 * and only for the work just handed in.
 */

// Strip the answer before sending a question to a student. Deliberately the
// same shape assessmentController.publicQuestion produces, so the two flows
// look identical to the client.
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

// What a teacher sees for one assignment.
function teacherView(h: InstanceType<typeof Homework>) {
  return {
    id: String(h._id),
    className: h.className,
    subject: h.subject,
    chapterSlug: h.chapterSlug,
    title: h.title,
    instructions: h.instructions,
    questionIds: h.questionIds.map((id) => String(id)),
    questionCount: h.questionIds.length,
    writtenQuestions: h.writtenQuestions || [],
    dueAt: h.dueAt,
    isPublished: h.isPublished,
    createdAt: h.createdAt,
  };
}

// ===========================================================================
// AUTHORING (teacher/admin)
// ===========================================================================

// POST /api/homework
// Body: { className, subject, chapterSlug?, title, instructions?, questionIds[],
//         dueAt, isPublished? }
export async function createHomework(req: AuthRequest, res: Response): Promise<void> {
  const b = req.body as Record<string, unknown>;
  const questionIds = Array.isArray(b.questionIds) ? (b.questionIds as string[]) : [];

  if (!b.className || !b.subject || !b.title || !b.dueAt) {
    res.status(400).json({ error: "className, subject, title and dueAt are required" });
    return;
  }
  const writtenQuestions = cleanWritten(b.writtenQuestions);
  if (questionIds.length === 0 && writtenQuestions.length === 0) {
    res.status(400).json({ error: "A homework needs at least one question" });
    return;
  }
  const dueAt = new Date(String(b.dueAt));
  if (Number.isNaN(dueAt.getTime())) {
    res.status(400).json({ error: "dueAt must be a date" });
    return;
  }
  if (questionIds.some((id) => !mongoose.isValidObjectId(id))) {
    res.status(400).json({ error: "questionIds must all be question ids" });
    return;
  }

  // Every question must exist AND belong to the class being assigned. Without
  // this a typo in the class field produces homework a student can open but
  // whose questions are from another syllabus.
  const found = await Question.find({
    _id: { $in: questionIds },
    className: String(b.className),
    subject: String(b.subject),
  }).select("_id");
  if (found.length !== questionIds.length) {
    res.status(400).json({
      error: "Every question must exist and belong to that class and subject",
    });
    return;
  }

  const hw = await Homework.create({
    className: String(b.className),
    subject: String(b.subject),
    chapterSlug: typeof b.chapterSlug === "string" ? b.chapterSlug : "",
    title: String(b.title),
    instructions: typeof b.instructions === "string" ? b.instructions : "",
    questionIds,
    writtenQuestions,
    dueAt,
    assignedById: req.user!.id,
    // requireRole("teacher") is the only way to reach this handler, and the
    // JWT role in this codebase is student|parent|teacher, there is no admin
    // to distinguish here.
    assignedByRole: "teacher",
    isPublished: b.isPublished === undefined ? true : Boolean(b.isPublished),
  });

  res.status(201).json({ homework: teacherView(hw) });
}

// GET /api/homework  (teacher), the assignments this teacher created.
export async function listHomework(req: AuthRequest, res: Response): Promise<void> {
  const { className, subject } = req.query as { className?: string; subject?: string };
  const filter: Record<string, unknown> = { assignedById: req.user!.id };
  if (className) filter.className = className;
  if (subject) filter.subject = subject;

  const rows = await Homework.find(filter).sort({ dueAt: -1 }).limit(200);

  // Submission counts, in one query rather than one per assignment.
  const ids = rows.map((r) => r._id);
  const counts = await HomeworkSubmission.aggregate([
    { $match: { homeworkId: { $in: ids } } },
    { $group: { _id: "$homeworkId", n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n as number]));

  res.json({
    total: rows.length,
    homework: rows.map((h) => ({
      ...teacherView(h),
      submissionCount: byId.get(String(h._id)) ?? 0,
    })),
  });
}

// PATCH /api/homework/:id  (teacher), edit, publish or unpublish.
export async function updateHomework(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const hw = await Homework.findById(id);
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  // A teacher may only touch their own assignment.
  if (String(hw.assignedById) !== req.user!.id) {
    res.status(403).json({ error: "That homework was assigned by someone else" });
    return;
  }

  const b = req.body as Record<string, unknown>;
  if (typeof b.title === "string" && b.title.trim()) hw.title = b.title.trim();
  if (typeof b.instructions === "string") hw.instructions = b.instructions;
  if (typeof b.chapterSlug === "string") hw.chapterSlug = b.chapterSlug;
  if (b.isPublished !== undefined) hw.isPublished = Boolean(b.isPublished);
  if (b.writtenQuestions !== undefined) hw.writtenQuestions = cleanWritten(b.writtenQuestions);
  if (b.dueAt !== undefined) {
    const d = new Date(String(b.dueAt));
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "dueAt must be a date" });
      return;
    }
    hw.dueAt = d;
  }
  if (Array.isArray(b.questionIds)) {
    const questionIds = b.questionIds as string[];
    if (questionIds.length === 0) {
      res.status(400).json({ error: "A homework needs at least one question" });
      return;
    }
    if (questionIds.some((qid) => !mongoose.isValidObjectId(qid))) {
      res.status(400).json({ error: "questionIds must all be question ids" });
      return;
    }
    const found = await Question.find({
      _id: { $in: questionIds },
      className: hw.className,
      subject: hw.subject,
    }).select("_id");
    if (found.length !== questionIds.length) {
      res.status(400).json({
        error: "Every question must exist and belong to that class and subject",
      });
      return;
    }
    hw.questionIds = questionIds.map((qid) => new mongoose.Types.ObjectId(qid));
  }

  await hw.save();
  res.json({ homework: teacherView(hw) });
}

// DELETE /api/homework/:id  (teacher)
export async function deleteHomework(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const hw = await Homework.findById(id);
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  if (String(hw.assignedById) !== req.user!.id) {
    res.status(403).json({ error: "That homework was assigned by someone else" });
    return;
  }
  // The submissions go too. Leaving them behind would keep marks referring to
  // an assignment nobody can open.
  await HomeworkSubmission.deleteMany({ homeworkId: hw._id });
  const files = await HomeworkUpload.find({ homeworkId: hw._id });
  for (const f of files) fs.rm(path.join(HOMEWORK_UPLOAD_DIR, f.filename), { force: true }, () => {});
  await HomeworkUpload.deleteMany({ homeworkId: hw._id });
  await hw.deleteOne();
  res.json({ deleted: true });
}

// GET /api/homework/:id/submissions  (teacher), the roster with scores.
export async function homeworkSubmissions(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const hw = await Homework.findById(id);
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  if (String(hw.assignedById) !== req.user!.id) {
    res.status(403).json({ error: "That homework was assigned by someone else" });
    return;
  }

  const subs = await HomeworkSubmission.find({ homeworkId: hw._id })
    .populate<{ studentId: { _id: mongoose.Types.ObjectId; name: string; rollNumber?: string } }>(
      "studentId",
      "name rollNumber"
    )
    .sort({ submittedAt: -1 });

  const ups = await HomeworkUpload.find({ homeworkId: hw._id }).populate<{
    studentId: { _id: mongoose.Types.ObjectId; name: string; rollNumber?: string };
  }>("studentId", "name rollNumber");
  const upByStudent = new Map(ups.map((u) => [String(u.studentId?._id ?? u.studentId), u]));

  const rows = subs.map((s) => {
    const sid = String(s.studentId?._id ?? s.studentId);
    const up = upByStudent.get(sid);
    upByStudent.delete(sid);
    return {
      id: String(s._id),
      studentId: sid,
      studentName: s.studentId?.name ?? "",
      rollNumber: s.studentId?.rollNumber ?? "",
      score: s.score,
      total: s.total,
      status: s.status,
      submittedAt: s.submittedAt,
      upload: uploadView(up),
    };
  });
  // Written answers handed in before (or without) the multiple-choice part.
  for (const [sid, up] of upByStudent) {
    rows.push({
      id: String(up._id),
      studentId: sid,
      studentName: up.studentId?.name ?? "",
      rollNumber: up.studentId?.rollNumber ?? "",
      score: null as unknown as number,
      total: hw.questionIds.length,
      status: "uploaded" as never,
      submittedAt: up.uploadedAt,
      upload: uploadView(up),
    });
  }

  res.json({
    homework: teacherView(hw),
    total: rows.length,
    submissions: rows,
  });
}

// ===========================================================================
// STUDENT
// ===========================================================================

// GET /api/homework/assigned?subject=&chapterSlug=
// Published homework for the student's own class, with their status on each.
export async function assignedHomework(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students have assigned homework" });
    return;
  }

  const { subject, chapterSlug } = req.query as { subject?: string; chapterSlug?: string };
  const filter: Record<string, unknown> = { className: user.className, isPublished: true };
  if (subject) filter.subject = subject;
  if (chapterSlug) filter.chapterSlug = chapterSlug;

  const rows = await Homework.find(filter).sort({ dueAt: 1 }).limit(100);

  const mine = await HomeworkSubmission.find({
    homeworkId: { $in: rows.map((r) => r._id) },
    studentId: user._id,
  });
  const subByHw = new Map(mine.map((s) => [String(s.homeworkId), s]));
  const myUploads = await HomeworkUpload.find({
    homeworkId: { $in: rows.map((r) => r._id) },
    studentId: user._id,
  });
  const upByHw = new Map(myUploads.map((u) => [String(u.homeworkId), u]));

  const now = Date.now();
  res.json({
    className: user.className,
    total: rows.length,
    homework: rows.map((h) => {
      const sub = subByHw.get(String(h._id));
      return {
        id: String(h._id),
        title: h.title,
        instructions: h.instructions,
        subject: h.subject,
        chapterSlug: h.chapterSlug,
        questionCount: h.questionIds.length,
        writtenCount: (h.writtenQuestions || []).length,
        upload: uploadView(upByHw.get(String(h._id))),
        dueAt: h.dueAt,
        // "overdue" is a display state for work not yet done; once submitted
        // the status is what happened, which is submitted or late.
        overdue: !sub && h.dueAt.getTime() < now,
        status: sub ? sub.status : "assigned",
        score: sub ? sub.score : null,
        total: sub ? sub.total : h.questionIds.length,
        submittedAt: sub ? sub.submittedAt : null,
      };
    }),
  });
}

// GET /api/homework/:id  (student), the questions, WITHOUT answers.
export async function getHomeworkForStudent(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students have assigned homework" });
    return;
  }
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const hw = await Homework.findById(id);
  // Unpublished or another class's work is reported as missing rather than
  // forbidden: "not found" tells someone probing ids nothing about what
  // exists.
  if (!hw || !hw.isPublished || hw.className !== user.className) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }

  const questions = await Question.find({ _id: { $in: hw.questionIds } });
  // Keep the teacher's order rather than Mongo's.
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const ordered = hw.questionIds
    .map((qid) => byId.get(String(qid)))
    .filter((q) => Boolean(q)) as typeof questions;

  const existing = await HomeworkSubmission.findOne({ homeworkId: hw._id, studentId: user._id });
  const myUpload = await HomeworkUpload.findOne({ homeworkId: hw._id, studentId: user._id });

  // Once handed in, the student can look back at what they answered, with the
  // right answers and why, the same review the submit response carries. Before
  // that, answers stay hidden.
  let review;
  if (existing) {
    const picked = new Map(existing.answers.map((a) => [String(a.questionId), a.selectedIndex]));
    review = ordered.map((q) => {
      const raw = picked.get(String(q._id));
      const selectedIndex = typeof raw === "number" ? raw : -1;
      return {
        questionId: String(q._id),
        text: q.text,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect: selectedIndex === q.correctIndex,
        explanation: q.explanation || "",
      };
    });
  }

  res.json({
    homework: {
      id: String(hw._id),
      title: hw.title,
      instructions: hw.instructions,
      subject: hw.subject,
      chapterSlug: hw.chapterSlug,
      dueAt: hw.dueAt,
      overdue: !existing && hw.dueAt.getTime() < Date.now(),
      status: existing ? existing.status : "assigned",
      score: existing ? existing.score : null,
      total: existing ? existing.total : null,
      submittedAt: existing ? existing.submittedAt : null,
      writtenQuestions: hw.writtenQuestions || [],
      upload: uploadView(myUpload),
    },
    total: ordered.length,
    questions: ordered.map(publicQuestion),
    ...(review ? { review } : {}),
  });
}

// POST /api/homework/:id/submit   Body: { answers: [{ questionId, selectedIndex }] }
// Grades, stores, and returns per-question correctness with explanations.
export async function submitHomework(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    res.status(403).json({ error: "Only students can submit homework" });
    return;
  }
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const hw = await Homework.findById(id);
  if (!hw || !hw.isPublished || hw.className !== user.className) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }

  const already = await HomeworkSubmission.findOne({ homeworkId: hw._id, studentId: user._id });
  if (already) {
    res.status(409).json({ error: "You have already submitted this homework" });
    return;
  }

  const body = req.body as { answers?: Array<{ questionId?: string; selectedIndex?: number }> };
  const given = Array.isArray(body.answers) ? body.answers : [];
  const chosen = new Map<string, number>();
  for (const a of given) {
    if (!a || typeof a.questionId !== "string") continue;
    chosen.set(a.questionId, Number(a.selectedIndex));
  }

  const questions = await Question.find({ _id: { $in: hw.questionIds } });
  const byId = new Map(questions.map((q) => [String(q._id), q]));

  // Grade every question the teacher set, not every answer the client sent ,
  // an omitted answer is a wrong answer, and an answer to a question that is
  // not on this homework is ignored rather than counted.
  const answers = [];
  const review = [];
  let score = 0;
  for (const qid of hw.questionIds) {
    const q = byId.get(String(qid));
    if (!q) continue;
    const raw = chosen.get(String(qid));
    const selectedIndex =
      Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) < q.options.length
        ? (raw as number)
        : -1;
    const isCorrect = selectedIndex === q.correctIndex;
    if (isCorrect) score += 1;
    answers.push({ questionId: q._id, selectedIndex, isCorrect });
    review.push({
      questionId: String(q._id),
      text: q.text,
      options: q.options,
      selectedIndex,
      correctIndex: q.correctIndex,
      isCorrect,
      explanation: q.explanation || "",
    });
  }

  // Late work is accepted and flagged, not refused.
  const status = hw.dueAt.getTime() < Date.now() ? "late" : "submitted";

  let saved;
  try {
    saved = await HomeworkSubmission.create({
      homeworkId: hw._id,
      studentId: user._id,
      answers,
      score,
      total: answers.length,
      submittedAt: new Date(),
      status,
    });
  } catch {
    // The unique index rejected it, so a second submit arrived while this one
    // was grading. The first is the submission.
    res.status(409).json({ error: "You have already submitted this homework" });
    return;
  }

  res.status(201).json({
    submission: {
      id: String(saved._id),
      score,
      total: answers.length,
      status,
      submittedAt: saved.submittedAt,
    },
    review,
  });
}

// ===========================================================================
// WRITTEN ANSWERS (PDF / photo upload)
// ===========================================================================

// POST /api/homework/:id/upload   multipart field "file" (student)
// One file per student per homework; uploading again replaces it.
export async function uploadHomeworkAnswers(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file;
  const discard = () => { if (file) fs.rm(file.path, { force: true }, () => {}); };
  const user = await User.findById(req.user!.id);
  if (!user || user.role !== "student") {
    discard();
    res.status(403).json({ error: "Only students can upload homework answers" });
    return;
  }
  const { id } = req.params;
  const hw = mongoose.isValidObjectId(id) ? await Homework.findById(id) : null;
  if (!hw || !hw.isPublished || hw.className !== user.className) {
    discard();
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  if (!file) {
    res.status(400).json({ error: "Choose a PDF or a photo of your answers" });
    return;
  }

  const previous = await HomeworkUpload.findOne({ homeworkId: hw._id, studentId: user._id });
  const saved = await HomeworkUpload.findOneAndUpdate(
    { homeworkId: hw._id, studentId: user._id },
    {
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (previous && previous.filename !== file.filename) {
    fs.rm(path.join(HOMEWORK_UPLOAD_DIR, previous.filename), { force: true }, () => {});
  }
  res.status(201).json({ upload: uploadView(saved) });
}

// GET /api/homework/:id/upload/file?token=...[&student=<id>]
// The student opens their own file; the teacher who set the homework opens any
// student's by passing ?student=.
export async function downloadHomeworkAnswers(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const hw = mongoose.isValidObjectId(id) ? await Homework.findById(id) : null;
  if (!hw) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  let studentId = req.user!.id;
  if (req.user!.role === "teacher") {
    if (String(hw.assignedById) !== req.user!.id) {
      res.status(403).json({ error: "That homework was assigned by someone else" });
      return;
    }
    const q = String(req.query.student ?? "");
    if (!mongoose.isValidObjectId(q)) {
      res.status(400).json({ error: "Which student?" });
      return;
    }
    studentId = q;
  } else if (req.user!.role !== "student") {
    res.status(403).json({ error: "Not allowed" });
    return;
  }

  const up = await HomeworkUpload.findOne({ homeworkId: hw._id, studentId });
  const filePath = up ? path.join(HOMEWORK_UPLOAD_DIR, up.filename) : "";
  if (!up || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "No answers uploaded" });
    return;
  }
  const safe = (up.originalName || "answers").replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
  res.setHeader("Content-Type", up.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
  res.setHeader("Content-Length", String(fs.statSync(filePath).size));
  fs.createReadStream(filePath).pipe(res);
}
