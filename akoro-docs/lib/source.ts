import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import { openapi } from '@/lib/openapi';

export const source = loader({
  baseUrl: '/docs',
  source: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: 'api-reference' }),
  },
  plugins: [openapi.loaderPlugin()],
});
