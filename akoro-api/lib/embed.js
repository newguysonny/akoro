/**
 * lib/embed.js — plain embeddings for storing a vector (notes, chunks, topics).
 *
 * The provider call lives in lib/searchEmbedding.js; this is the shared entry
 * point teaching and curriculum import. Searches use embedForSearch directly.
 */
export { embed } from "./searchEmbedding.js";
