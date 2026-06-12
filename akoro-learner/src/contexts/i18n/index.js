/**
 * Aggregates every non-English language catalog keyed by BCP-47 code.
 * The English master lives in ./en.js and is merged separately.
 */
import { ES }  from './es.js';
import { PT }  from './pt.js';
import { FR }  from './fr.js';
import { YO }  from './yo.js';
import { IG }  from './ig.js';
import { HA }  from './ha.js';
import { PCM } from './pcm.js';
import { AR }  from './ar.js';

export const TRANSLATIONS = {
  es: ES, pt: PT, fr: FR, yo: YO, ig: IG, ha: HA, pcm: PCM, ar: AR,
};
