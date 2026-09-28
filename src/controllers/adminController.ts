import { Request, Response } from "express";
import { User } from "../models/User";

// GET /api/admin/users, list every registered user (no passwords).
// Used by the admin DB viewer page to prove data is persisted.
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await User.find()
    .select("-password")
    .sort({ createdAt: -1 })
    .lean();

  const shaped = users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    rollNumber: u.rollNumber || "",
    teacherId: u.teacherId || "",
    className: u.className || "",
    section: u.section || "",
    board: u.board || "",
    children: (u.childLinks || []).length,
    createdAt: u.createdAt,
  }));

  res.json({
    total: shaped.length,
    counts: {
      student: shaped.filter((u) => u.role === "student").length,
      teacher: shaped.filter((u) => u.role === "teacher").length,
      parent: shaped.filter((u) => u.role === "parent").length,
    },
    users: shaped,
  });
}
