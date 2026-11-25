import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Akoro platform status',
  robots: { index: false, follow: false },
};

export default function StatusPage() {
  const url = process.env.NEXT_PUBLIC_STATUS_URL;
  if (url) redirect(url);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Akoro status</h1>
      <p>The managed status page is being configured. Once live, this page redirects to it.</p>
      <p>For help in the meantime, see the <a href="/docs">documentation</a>.</p>
    </main>
  );
}
