import entries from '@/content/changelog.json';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://docs.akoro.ng';

export function GET() {
  return Response.json({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Akoro Changelog',
    home_page_url: `${site}/docs/changelog`,
    feed_url: `${site}/changelog/feed.json`,
    items: entries.map((entry) => ({
      id: entry.slug,
      title: entry.title,
      url: `${site}/docs/changelog`,
      date_published: new Date(entry.date).toISOString(),
      summary: entry.summary,
      content_text: entry.body,
    })),
  });
}
