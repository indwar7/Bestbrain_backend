const TOPIC_STOPWORDS = new Set(["of", "the", "a", "an", "to", "and", "or", "in", "on", "for", "with"]);

export function topicWords(v: unknown): string[] {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ") // punctuation → space
    .split(/\s+/)
    .filter((w) => w && !TOPIC_STOPWORDS.has(w));
}

// True when some run of consecutive words in `words`, written without spaces,
// spells `squashed`. This is what lets "Non-metals" and "non metals" match a
// chapter stored as "nonmetals" (and the other way round) without matching
// inside a longer word.
function spellsRun(words: string[], squashed: string): boolean {
  if (!squashed) return false;
  for (let i = 0; i < words.length; i++) {
    let run = "";
    for (let j = i; j < words.length && run.length < squashed.length; j++) {
      run += words[j];
      if (run === squashed) return true;
    }
  }
  return false;
}

// Match a chapter's search term against a free-text topic. Teachers type the
// topic by hand, so word order and filler drift ("Sources of Food",
// "Introduction to Food Sources") relative to the chapter slug the lesson hub
// sends ("food sources"). Compare the significant words as sets and accept when
// one side's words are all contained in the other, a plain substring test
// missed every reorder or added descriptor, so real uploads never appeared
// under their chapter. Both empty → no match (an untagged upload is not claimed
// by every chapter).
export function topicMatches(wantTopic: string, haveTopic: unknown): boolean {
  const want = topicWords(wantTopic);
  const have = topicWords(haveTopic);
  if (!want.length || !have.length) return false;
  const haveSet = new Set(have);
  const wantSet = new Set(want);
  if (want.every((w) => haveSet.has(w)) || have.every((w) => wantSet.has(w))) return true;
  return spellsRun(have, want.join("")) || spellsRun(want, have.join(""));
}
