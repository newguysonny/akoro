import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const base = process.env.NEXT_PUBLIC_DOCS_URL || 'https://docs.akoro.ng';
const lastModified = new Date('2026-11-25');

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/changelog`, lastModified },
    { url: `${base}/status`, lastModified },
  ];

  for (const page of source.getPages()) {
    entries.push({ url: `${base}${page.url}`, lastModified });
  }

  return entries;
}
