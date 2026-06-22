import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { Subject } from "../models/Subject";
import { Chapter } from "../models/Chapter";

// "Fractions & Decimals" -> "fractions-decimals"
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function authorRole(req: AuthRequest): "teacher" | "admin" {
  return req.user?.role === "teacher" ? "teacher" : "admin";
}

// ---------------------------------------------------------------------------
// SUBJECTS
// ---------------------------------------------------------------------------

// GET /api/curriculum/subjects?className=Class 7&board=CBSE
export async function listSubjects(req: AuthRequest, res: Response): Promise<void> {
  const { className, board } = req.query as { className?: string; board?: string };
  const filter: Record<string, unknown> = {};
  if (className) filter.className = className;
  if (board) filter.board = board;

  const subjects = await Subject.find(filter).sort({ className: 1, name: 1 }).lean();
  res.json({ subjects });
}

// POST /api/curriculum/subjects   (teacher/admin)
// Body: { name, className, board?, description? }
export async function createSubject(req: AuthRequest, res: Response): Promise<void> {
  const { name, className, board, description } = req.body as Record<string, string>;
  if (!name || !className) {
    res.status(400).json({ error: "name and className are required" });
    return;
  }

  const slug = `${slugify(name)}-${slugify(className)}`;
  if (await Subject.findOne({ slug })) {
    res.status(409).json({ error: "A subject with this name already exists for that class" });
    return;
  }

  const subject = await Subject.create({
    name,
    slug,
    className,
    board: board || "",
    description: description || "",
    createdById: req.user?.id,
    createdByRole: authorRole(req),
  });
  res.status(201).json({ subject });
}

// ---------------------------------------------------------------------------
// CHAPTERS
// ---------------------------------------------------------------------------

// GET /api/curriculum/subjects/:subjectId/chapters
export async function listChapters(req: AuthRequest, res: Response): Promise<void> {
  const subject = await Subject.findById(req.params.subjectId).lean();
  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }
  const chapters = await Chapter.find({ subjectId: subject._id })
    .sort({ order: 1, createdAt: 1 })
    .lean();
  res.json({ subject, chapters });
}

// GET /api/curriculum/chapters/:id
export async function getChapter(req: AuthRequest, res: Response): Promise<void> {
  const chapter = await Chapter.findById(req.params.id).lean();
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  res.json({ chapter });
}

// POST /api/curriculum/chapters   (teacher/admin)
// Body: { subjectId, title, slug?, order?, description?, estimatedMinutes?, prerequisites?, isPublished? }
export async function createChapter(req: AuthRequest, res: Response): Promise<void> {
  const {
    subjectId,
    title,
    slug,
    order,
    description,
    estimatedMinutes,
    prerequisites,
    isPublished,
  } = req.body as Record<string, unknown>;

  if (!subjectId || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "subjectId and a title string are required" });
    return;
  }
  const subject = await Subject.findById(subjectId);
  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const finalSlug = slugify(typeof slug === "string" && slug ? slug : title);
  if (await Chapter.findOne({ subjectId: subject._id, slug: finalSlug })) {
    res.status(409).json({ error: "A chapter with this slug already exists in this subject" });
    return;
  }

  // Default order = end of the list if not provided.
  let finalOrder = Number(order);
  if (!Number.isFinite(finalOrder) || finalOrder <= 0) {
    finalOrder = (await Chapter.countDocuments({ subjectId: subject._id })) + 1;
  }

  const chapter = await Chapter.create({
    subjectId: subject._id,
    title,
    slug: finalSlug,
    order: finalOrder,
    description: typeof description === "string" ? description : "",
    estimatedMinutes: Number(estimatedMinutes) || 0,
    prerequisites: Array.isArray(prerequisites) ? prerequisites : [],
    isPublished: isPublished === undefined ? true : Boolean(isPublished),
    createdById: req.user?.id,
    createdByRole: authorRole(req),
  });
  res.status(201).json({ chapter });
}

// PATCH /api/curriculum/chapters/:id   (teacher/admin)
export async function updateChapter(req: AuthRequest, res: Response): Promise<void> {
  const allowed = [
    "title",
    "order",
    "description",
    "estimatedMinutes",
    "prerequisites",
    "isPublished",
  ] as const;
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  const chapter = await Chapter.findByIdAndUpdate(req.params.id, updates, {
    returnDocument: "after",
    runValidators: true,
  });
  if (!chapter) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  res.json({ chapter });
}

// DELETE /api/curriculum/chapters/:id   (teacher/admin)
export async function deleteChapter(req: AuthRequest, res: Response): Promise<void> {
  const result = await Chapter.deleteOne({ _id: req.params.id });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Chapter not found" });
    return;
  }
  res.json({ deleted: true });
}
