/**
 * Builds (or tops up) a Vertex AI RAG Engine corpus from a folder of files, so
 * PAL can ground its answers in the real textbook instead of general knowledge.
 *
 * Files are uploaded straight to RAG Engine (ragFiles:upload), no GCS bucket
 * is needed. Re-running is safe: a corpus is found by its display name and a
 * file already in it (same display name) is skipped.
 *
 * Run with:
 *   npm run rag:ingest -- "<corpus name>" <folder>
 *   e.g. npm run rag:ingest -- "Class 7 Science" ./ncert/class7-science
 *
 * Then put the printed resource name in PAL_RAG_CORPORA (see env.ts).
 */
import fs from "fs";
import path from "path";
import { GoogleAuth } from "google-auth-library";
import { env } from "../config/env";

const LOCATION = process.env.VERTEX_RAG_LOCATION ?? "asia-south1";
// Multilingual so a Hindi/Hinglish question still finds the English text.
const EMBEDDING_MODEL = "text-multilingual-embedding-002";
const ALLOWED = new Set([".pdf", ".txt", ".md", ".html", ".docx"]);

const [displayName, folder] = process.argv.slice(2);
if (!displayName || !folder) {
  console.error('usage: npm run rag:ingest -- "<corpus name>" <folder>');
  process.exit(1);
}

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  ...(env.googleCredentialsJson
    ? { credentials: JSON.parse(env.googleCredentialsJson) }
    : { keyFile: path.resolve(env.googleCredentialsFile) }),
});

const host = `https://${LOCATION}-aiplatform.googleapis.com`;
const parent = `projects/${env.vertexProject}/locations/${LOCATION}`;

async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${body}`);
  return body ? JSON.parse(body) : ({} as T);
}

async function waitForOperation(name: string): Promise<any> {
  for (;;) {
    const op = await api(`${host}/v1/${name}`);
    if (op.done) {
      if (op.error) throw new Error(`operation failed: ${JSON.stringify(op.error)}`);
      return op.response;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function findOrCreateCorpus(): Promise<string> {
  const list = await api(`${host}/v1/${parent}/ragCorpora?pageSize=100`);
  const existing = (list.ragCorpora ?? []).find((c: any) => c.displayName === displayName);
  if (existing) {
    console.log(`using existing corpus ${existing.name}`);
    return existing.name;
  }

  const op = await api(`${host}/v1/${parent}/ragCorpora`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName,
      description: `BestBrain PAL grounding material: ${displayName}`,
      vectorDbConfig: {
        ragEmbeddingModelConfig: {
          vertexPredictionEndpoint: {
            endpoint: `${parent}/publishers/google/models/${EMBEDDING_MODEL}`,
          },
        },
      },
    }),
  });
  const corpus = await waitForOperation(op.name);
  console.log(`created corpus ${corpus.name}`);
  return corpus.name;
}

async function existingFiles(corpus: string): Promise<Set<string>> {
  const names = new Set<string>();
  let pageToken = "";
  do {
    const page = await api(
      `${host}/v1/${corpus}/ragFiles?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    for (const f of page.ragFiles ?? []) names.add(f.displayName);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return names;
}

async function uploadFile(corpus: string, file: string): Promise<void> {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      rag_file: { display_name: path.basename(file) },
      upload_rag_file_config: {
        rag_file_transformation_config: {
          rag_file_chunking_config: {
            fixed_length_chunking: { chunk_size: 512, chunk_overlap: 100 },
          },
        },
      },
    })
  );
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  await api(`${host}/upload/v1/${corpus}/ragFiles:upload`, {
    method: "POST",
    headers: { "X-Goog-Upload-Protocol": "multipart" },
    body: form,
  });
}

async function main() {
  if (!env.vertexConfigured) throw new Error("Vertex is not configured, see env.ts");

  const files = fs
    .readdirSync(folder)
    .filter((f) => ALLOWED.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(folder, f));
  if (files.length === 0) throw new Error(`no ${[...ALLOWED].join("/")} files in ${folder}`);

  const corpus = await findOrCreateCorpus();
  const have = await existingFiles(corpus);

  for (const file of files) {
    if (have.has(path.basename(file))) {
      console.log(`skip   ${path.basename(file)} (already in corpus)`);
      continue;
    }
    process.stdout.write(`upload ${path.basename(file)} ... `);
    try {
      await uploadFile(corpus, file);
    } catch (err) {
      // The upload call stays open while RAG Engine parses and embeds the
      // file; a large PDF can outlast fetch's 5-minute header timeout even
      // though the server finishes. Wait for the file to show up instead.
      if ((err as any)?.cause?.code !== "UND_ERR_HEADERS_TIMEOUT") throw err;
      process.stdout.write("timed out, waiting for server ... ");
      const deadline = Date.now() + 15 * 60_000;
      while (!(await existingFiles(corpus)).has(path.basename(file))) {
        if (Date.now() > deadline) throw new Error(`${path.basename(file)} never appeared`);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
    console.log("ok");
  }

  console.log(`\nDone. Add to .env:\nPAL_RAG_CORPORA="<className>=${corpus}"  (e.g. Class 7=...)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
