// =============================================================
// training/store.js
// Object storage, embedding, vector chunks and the teacher profile row.
// =============================================================

import db from "../../../db.js";
import { v4 as uuid } from "uuid";
import fs from "fs";
import { openai } from "../../../lib/aiModel.js";

async function uploadToStorage(localPath, destPath, mimeType) {
  const buffer = fs.readFileSync(localPath);
  const { error } = await db.storage
    .from("training-assets")
    .upload(destPath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;
}

async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.substring(0, 8000),
  });
  return res.data[0].embedding;
}

async function storeChunk({ teacherId, agentId, sessionId, chunkText, chunkType, metadata, embedding }) {
  const { error } = await db.schema("edu").from("training_chunks").insert({
    id: uuid(), teacher_id: teacherId, agent_id: agentId,
    session_id: sessionId, chunk_text: chunkText, chunk_type: chunkType,
    metadata: metadata || {}, embedding, created_at: new Date(),
  });
  if (error) throw error;
}

async function retrieveChunks(teacherId, queryEmbedding, limit = 6) {
  const { data, error } = await db.rpc("match_training_chunks", {
    p_teacher_id: teacherId, p_query_embedding: queryEmbedding, p_match_count: limit,
  });
  if (error) throw error;
  return data || [];
}

// ── Teacher profile upsert ────────────────────────────────────
async function upsertTeacherProfile(teacherId, agentId, updates) {
  const { error } = await db
    .schema("edu").from("teacher_profiles")
    .upsert({ teacher_id: teacherId, agent_id: agentId, ...updates, updated_at: new Date() },
            { onConflict: "teacher_id" });
  if (error) throw error;
}

export { uploadToStorage, embed, storeChunk, retrieveChunks, upsertTeacherProfile };
