import { describe, it, expect } from "vitest";
import { topicMatches } from "../src/utils/topicMatch";

// The lesson page asks for a chapter by its slug words; the topic is whatever
// the teacher typed (or picked) at upload.
describe("topicMatches, chapter slug against an upload's topic", () => {
  const cases: Array<[string, string]> = [
    ["metals nonmetals", "metals nonmetals"],
    ["metals nonmetals", "The World of Metals and Non-metals"],
    ["metals nonmetals", "Metals and Non metals"],
    ["electricity circuits", "Electricity"],
    ["electricity circuits", "Electricity: Circuits and their Components"],
    ["time and motion", "Measurement of Time and Motion"],
    ["evolving science", "The Ever-Evolving World of Science"],
    ["acidic basic neutral", "Exploring Substances: Acidic, Basic & Neutral"],
    ["physical chemical changes", "Changes Around Us: Physical and Chemical"],
    ["earth moon sun", "Earth, Moon and the Sun"],
  ];
  for (const [slug, typed] of cases) {
    it(`"${typed}" belongs to "${slug}"`, () => {
      expect(topicMatches(slug, typed)).toBe(true);
    });
  }

  it("does not claim another chapter's upload", () => {
    expect(topicMatches("heat transfer", "Light: Shadows and Reflections")).toBe(false);
    expect(topicMatches("life processes animals", "Life Processes in Plants")).toBe(false);
    expect(topicMatches("heat transfer", "Wheat transfer")).toBe(false);
  });

  it("does not claim an untagged upload", () => {
    expect(topicMatches("heat transfer", "")).toBe(false);
  });
});
