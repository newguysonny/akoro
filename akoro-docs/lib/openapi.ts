import { createOpenAPI } from 'fumadocs-openapi/server';

export const openapi = createOpenAPI({
  input: { akoro: './openapi/akoro.yaml' },
  includeDocument: true,
});
