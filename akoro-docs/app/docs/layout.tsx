import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: 'Akoro Docs' }}
      githubUrl="https://github.com/newguysonny/akoro"
      links={[
        { text: 'Changelog', url: '/docs/changelog' },
        ...(process.env.NEXT_PUBLIC_STATUS_URL ? [{ text: 'Status', url: '/status' }] : []),
      ]}
    >
      {children}
    </DocsLayout>
  );
}
