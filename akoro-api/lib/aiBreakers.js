/**
 * lib/aiBreakers.js — the provider circuit breakers, extracted from
 * aiModel.js. One breaker per endpoint family; every model call in the app
 * funnels through these call sites, so provider trouble fails fast everywhere
 * at once instead of hanging each request on its own SDK timeout.
 */

import { makeAiBreaker } from "./circuitBreaker.js";
import { embeddingsProvider, runpodEmbeddings } from "./embeddingProvider.js";

export function makeAiBreakers(rawClient) {
  const chat = makeAiBreaker(
    "openai-chat",
    (params, reqOpts) => rawClient.chat.completions.create(params, reqOpts),
  );
  const responses = makeAiBreaker(
    "openai-responses",
    (params, reqOpts) => rawClient.responses.create(params, reqOpts),
  );
  // Our own RunPod endpoint when EMBEDDINGS_PROVIDER=runpod (lib/embeddingProvider.js), else OpenAI — never both.
  const embeddings = makeAiBreaker(
    "openai-embeddings",
    (params) => (embeddingsProvider() === "runpod" ? runpodEmbeddings(params) : rawClient.embeddings.create(params)),
  );
  return { chat, responses, embeddings };
}
