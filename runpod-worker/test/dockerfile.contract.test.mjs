/**
 * Dockerfile contract — the runtime image must carry a C/C++ toolchain.
 *
 * v1.0.4 reached model.generate() for the first time and died there:
 * triton JIT-compiles kernels + a host-side launcher on first use and
 * needs gcc/g++, which python:3.10-slim does not ship
 * ("RuntimeError: Failed to find C compiler", live 2026-10-09).
 * This pins the toolchain into the image so it can't regress.
 */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = await readFile(join(here, "..", "Dockerfile"), "utf8");

test("the image installs a C/C++ toolchain for triton's runtime JIT", () => {
  assert.match(dockerfile, /apt-get install[^\n]*build-essential/);
});

test("apt lists are cleaned after install — layer stays lean", () => {
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/*/);
});
