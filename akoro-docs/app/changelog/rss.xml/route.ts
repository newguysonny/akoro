import entries from '@/content/changelog.json';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://docs.akoro.ng';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET() {
  const items = entries.map((entry) => `
    <item>
      <title>${escape(entry.title)}</title>
      <link>${site}/docs/changelog</link>
      <guid isPermaLink="false">${entry.slug}</guid>
      <pubDate>${new Date(entry.date).toUTCString()}</pubDate>
      <description>${escape(entry.summary)}</description>
    </item>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Akoro Changelog</title>
    <link>${site}/docs/changelog</link>
    <description>New updates and improvements to Akoro.</description>
    <language>en</language>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
