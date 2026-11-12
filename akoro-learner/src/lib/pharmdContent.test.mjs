import test from "node:test";
import assert from "node:assert/strict";
import { pharmdContentKey } from "./pharmdContent.js";

test("the shared key comes from contentKey, or is derived from the public URL", () => {
  assert.equal(pharmdContentKey({ contentKey: "pharmd:BIO 111/01.pdf" }), "pharmd:BIO 111/01.pdf");
  assert.equal(
    pharmdContentKey({ file_url: "https://x.supabase.co/storage/v1/object/public/pharmd-courses/BIO%20111/01%20-%20Cell%20Structure%20and%20Organization.pdf?download=1" }),
    "pharmd:BIO 111/01 - Cell Structure and Organization.pdf",
  );
  assert.equal(pharmdContentKey({ file_url: "https://example.com/other/file.pdf" }), null);
  assert.equal(pharmdContentKey({}), null);
});
