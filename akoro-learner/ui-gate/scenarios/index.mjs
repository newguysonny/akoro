/** Every frontend-gate scenario, by suite. Order matters within a suite. */
import { scenarios as auth } from './auth.mjs';
import { scenarios as reader } from './reader.mjs';
import { scenarios as chat } from './chat.mjs';

export const SUITES = { auth, reader, chat, all: [...auth, ...reader, ...chat] };
export const ALL = SUITES.all;
