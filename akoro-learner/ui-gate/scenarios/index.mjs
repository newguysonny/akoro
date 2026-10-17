/** Every frontend-gate scenario, by suite. Order matters within a suite. */
import { scenarios as auth } from './auth.mjs';
import { scenarios as reader } from './reader.mjs';

export const SUITES = { auth, reader, all: [...auth, ...reader] };
export const ALL = SUITES.all;
