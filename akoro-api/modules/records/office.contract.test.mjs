import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import AdmZip from "adm-zip";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const {
  officeKindOf, docxToPages, pptxToPages, paginate, decodeXml, extractOfficeContent, downloadCapped, OFFICE_LIMITS,
} = await import("./officeText.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const zipOf = (files) => {
  const z = new AdmZip();
  for (const [name, text] of Object.entries(files)) z.addFile(name, Buffer.from(text, "utf8"));
  return z.toBuffer();
};
const para = (text, style = null, extra = "") =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = (bodyXml, styles = "") => zipOf({
  "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`,
  ...(styles ? { "word/styles.xml": `<w:styles ${W}>${styles}</w:styles>` } : {}),
});

test("office kinds are recognised by mime or extension, nothing else", () => {
  assert.equal(officeKindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x"), "docx");
  assert.equal(officeKindOf("application/vnd.openxmlformats-officedocument.presentationml.presentation", "x"), "pptx");
  assert.equal(officeKindOf("", "Notes.DOCX"), "docx");
  assert.equal(officeKindOf("application/octet-stream", "deck.pptx"), "pptx");
  assert.equal(officeKindOf("application/msword", "old.doc"), null);
  assert.equal(officeKindOf("application/pdf", "a.pdf"), null);
});

test("entities decode, including numeric ones", () => {
  assert.equal(decodeXml("A &amp; B &lt;c&gt; &#233;t&#xE9; &quot;q&quot;"), 'A & B <c> été "q"');
});

test("DOCX: headings, lists, tables and runs come out as markdown blocks, in order", () => {
  const body = [
    para("Cell Biology", "Title"),
    para("The cell", "Heading1"),
    `<w:p><w:r><w:t>Cells are the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>basic unit</w:t></w:r><w:r><w:tab/><w:t>of life &amp; growth.</w:t></w:r></w:p>`,
    para("Nucleus", null, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`),
    para("Nucleolus", null, `<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>`),
    `<w:tbl><w:tr><w:tc>${para("Organelle")}</w:tc><w:tc>${para("Role")}</w:tc></w:tr>`
      + `<w:tr><w:tc>${para("Ribosome")}</w:tc><w:tc>${para("Makes | proteins")}</w:tc></w:tr></w:tbl>`,
    `<w:p/>`,
    para("Custom styled", "MyHead"),
  ].join("");
  const styles = `<w:style w:type="paragraph" w:styleId="MyHead"><w:name w:val="heading 2"/></w:style>`;
  const pages = docxToPages(docx(body, styles));
  assert.equal(pages.length, 1);
  const { markdown, blocks } = pages[0];
  assert.deepEqual(blocks.map((b) => b.text_content), [
    "# Cell Biology",
    "## The cell",
    "Cells are the basic unit\tof life & growth.".replace("\t", " "),
    "- Nucleus",
    "  - Nucleolus",
    "| Organelle | Role |\n| --- | --- |\n| Ribosome | Makes \\| proteins |",
    "### Custom styled",
  ]);
  assert.equal(markdown, blocks.map((b) => b.text_content).join("\n\n"));
  // Block i is anchored at y = i on the 0-1000 scale (reading order).
  blocks.forEach((b, i) => assert.deepEqual(b.bbox_2d, [0, i, 1000, i + 1]));
});

test("DOCX: long documents split into pages, preferring headings and page breaks", () => {
  const long = "word ".repeat(200).trim();   // ~1,000 chars
  const body = [
    para("Part one", "Heading1"), para(long), para(long), para(long), para(long),
    para("Part two", "Heading1"), para(long),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`, para("After the break"),
  ].join("");
  const pages = docxToPages(docx(body));
  assert.equal(pages.length, 3);
  assert.match(pages[0].markdown, /^## Part one/);
  assert.match(pages[1].markdown, /^## Part two/);
  assert.equal(pages[2].markdown, "After the break");
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2, 3]);
});

test("paginate: hard cut, total cap and page cap hold", () => {
  const L = { ...OFFICE_LIMITS, PAGE_TARGET_CHARS: 10, PAGE_HARD_CHARS: 20, MAX_PAGES: 2, MAX_TOTAL_CHARS: 1000 };
  const pages = paginate(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd", "eeeeeeeeee"].map((text) => ({ text })), L);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].markdown, "aaaaaaaaaa\n\nbbbbbbbbbb");
  const capped = paginate(["aaaaaaaaaa", "bbbbbbbbbb"].map((text) => ({ text })), { ...L, MAX_TOTAL_CHARS: 15 });
  assert.equal(capped[0].markdown, "aaaaaaaaaa");
});

test("damaged or non-office files fail with a plain message", () => {
  assert.throws(() => docxToPages(Buffer.from("not a zip at all, definitely not")), /damaged|not an Office/);
  assert.throws(() => docxToPages(zipOf({ "hello.txt": "x" })), /no document body/);
  assert.throws(() => pptxToPages(zipOf({ "hello.txt": "x" })), /no slides/);
  assert.throws(() => docxToPages(Buffer.alloc(3)), /empty/);
});

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const shape = (ph, paras) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph ${ph}/>` : ""}</p:nvPr></p:nvSpPr><p:spPr/>`
  + `<p:txBody><a:bodyPr/>${paras.map((t) => (typeof t === "string" ? `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>` : `<a:p><a:pPr lvl="${t.lvl}"/><a:r><a:t>${t.text}</a:t></a:r></a:p>`)).join("")}</p:txBody></p:sp>`;
const slide = (shapes) => `<p:sld ${A}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;

test("PPTX: one page per slide in presentation order — title, bullets, tables, notes", () => {
  const buf = zipOf({
    "ppt/presentation.xml": `<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships>${rel("rId2", "slide", "slides/slide1.xml")}${rel("rId3", "slide", "slides/slide2.xml")}</Relationships>`,
    // slide2.xml is FIRST in the deck (sldIdLst order wins over file names)
    "ppt/slides/slide2.xml": slide(
      shape('type="ctrTitle"', ["Photosynthesis"]) + shape('type="subTitle" idx="1"', ["How plants eat"])
      + shape('type="sldNum" idx="12"', ["1"]),
    ),
    "ppt/slides/slide1.xml": slide(
      shape('type="title"', ["Inputs &amp; outputs"])
      + shape('idx="1"', ["Light", { lvl: 1, text: "Chlorophyll absorbs it" }, "Water"])
      + `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>In</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Out</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    ),
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships>${rel("rId1", "notesSlide", "../notesSlides/notesSlide1.xml")}</Relationships>`,
    "ppt/notesSlides/notesSlide1.xml": `<p:notes ${A}><p:cSld><p:spTree>${shape('type="sldImg"', [])}${shape('type="body" idx="1"', ["Mention the Calvin cycle."])}${shape('type="sldNum" idx="5"', ["2"])}</p:spTree></p:cSld></p:notes>`,
  });
  const pages = pptxToPages(buf);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].blocks.map((b) => b.text_content), ["## Photosynthesis", "How plants eat"]);
  assert.deepEqual(pages[1].blocks.map((b) => b.text_content), [
    "## Inputs & outputs",
    "- Light",
    "  - Chlorophyll absorbs it",
    "- Water",
    "| In | Out |\n| --- | --- |",
    "> **Speaker notes:** Mention the Calvin cycle.",
  ]);
  pages[1].blocks.forEach((b, i) => assert.deepEqual(b.bbox_2d, [0, i, 1000, i + 1]));
});

test("PPTX without a slide list falls back to numeric order", () => {
  const buf = zipOf({
    "ppt/slides/slide10.xml": slide(shape('type="title"', ["Ten"])),
    "ppt/slides/slide2.xml": slide(shape('type="title"', ["Two"])),
  });
  assert.deepEqual(pptxToPages(buf).map((p) => p.markdown), ["## Two", "## Ten"]);
});

test("extraction flow: claim → save → index → finish; a held claim answers running; failures release", async () => {
  const calls = [];
  const lib = {
    claimContentJob: async (k, lane) => { calls.push(["claim", lane]); return true; },
    saveExtractionPages: async ({ model, pages }) => { calls.push(["save", model, pages.length]); },
    finishContentJob: async (k, lane, status, result) => { calls.push(["finish", status, result.mode]); },
  };
  const index = async ({ pages }) => { calls.push(["index", pages.length]); };
  const file = docx(para("Hello", "Heading1") + para("World"));
  const ok = await extractOfficeContent(
    { userId: "u", contentKey: "k", name: "a.docx", mime: "", fileUrl: "https://x" },
    { extractLib: lib, indexByContentKey: index, download: async () => file },
  );
  assert.equal(ok.status, "done");
  assert.deepEqual(calls, [["claim", "parse"], ["save", "docx-text", 1], ["index", 1], ["finish", "done", "office"]]);

  const held = await extractOfficeContent(
    { contentKey: "k", name: "a.docx", fileUrl: "https://x" },
    { extractLib: { ...lib, claimContentJob: async () => false }, indexByContentKey: index, download: async () => file },
  );
  assert.equal(held.status, "running");

  calls.length = 0;
  const bad = await extractOfficeContent(
    { contentKey: "k", name: "a.pptx", fileUrl: "https://x" },
    { extractLib: lib, indexByContentKey: index, download: async () => Buffer.from("garbage garbage garbage garbage") },
  );
  assert.equal(bad.status, "failed");
  assert.deepEqual(calls.at(-1), ["finish", "failed", "office"]);
  assert.equal((await extractOfficeContent({ contentKey: "k", name: "a.pdf", fileUrl: "x" })).status, "failed");
});

test("downloads are capped", async () => {
  const big = { ok: true, headers: { get: () => String(10) }, body: (async function* () { yield Buffer.alloc(6); yield Buffer.alloc(6); })() };
  await assert.rejects(downloadCapped("u", { maxBytes: 8, fetchImpl: async () => big }), /too large/);
  const declared = { ok: true, headers: { get: () => "999" }, body: [] };
  await assert.rejects(downloadCapped("u", { maxBytes: 8, fetchImpl: async () => declared }), /too large/);
  const fine = { ok: true, headers: { get: () => null }, body: (async function* () { yield Buffer.from("abc"); })() };
  assert.equal((await downloadCapped("u", { fetchImpl: async () => fine })).toString(), "abc");
});

test("routes: docx/pptx upload, extract at create, and an inline retry route", () => {
  assert.match(routes, /return officeKindOf\(mime, name\);/);
  assert.match(routes, /officeKindOf\(data\.mime, data\.name\)\)[\s\S]{0,200}extractOfficeContent/);
  assert.match(routes, /router\.post\("\/extract\/office", authenticateToken/);
  const route = routes.slice(routes.indexOf('router.post("/extract/office"'), routes.indexOf('router.get("/extract/:recordId"'));
  assert.match(route, /resolveAiContent\(req\)/);            // the shared access rule
  assert.match(route, /createPresignedDownload\(id\.contentKey/);   // the STORED bytes
  assert.doesNotMatch(route, /req\.body\?\.(pages|markdown|text)/);  // never caller-supplied text
});

test("DOCX: list styles (Word's 'List Bullet') are list items too", () => {
  const styles = `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>`
    + `<w:style w:type="paragraph" w:styleId="ListNumber2"><w:name w:val="List Number 2"/></w:style>`;
  const pages = docxToPages(docx(para("Top", "ListBullet") + para("Nested", "ListNumber2"), styles));
  assert.deepEqual(pages[0].blocks.map((b) => b.text_content), ["- Top", "  - Nested"]);
});
