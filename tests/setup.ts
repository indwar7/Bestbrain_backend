import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";

let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});

afterEach(async () => {
  // Wipe all collections between tests for isolation.
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

// Helpers shared across test files.
let counter = 0;
export function uniqueStudent() {
  counter += 1;
  const n = `${Date.now()}-${counter}`;
  return {
    name: "Test Student",
    email: `student-${n}@ex.com`,
    phone: "9999999999",
    password: "Passw0rd!",
    rollNumber: `EDU-T-${n}`,
    className: "Class 7",
    section: "A",
  };
}

export function uniqueTeacher() {
  counter += 1;
  const n = `${Date.now()}-${counter}`;
  return {
    name: "Test Teacher",
    email: `teacher-${n}@ex.com`,
    phone: "8888888888",
    password: "Passw0rd!",
    teacherId: `TCH-${n}`,
    className: "Class 7",
    section: "A",
    subject: "Maths",
  };
}
