import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
export default withMDX({
  reactStrictMode: true,
  // The Fumadocs OpenAPI source reads openapi/akoro.yaml from disk at request
  // time (referenced by string path, not import), so Next.js file tracing does
  // not include it by default. Without this the search route 500s on Vercel.
  outputFileTracingIncludes: {
    '/api/search': ['./openapi/akoro.yaml'],
  },
});
