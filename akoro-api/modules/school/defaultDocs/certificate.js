export default {
  id: "certificate",
  name: "Certificate of Achievement",
  description: "A landscape certificate with decorative border and signatures.",
  category: "certificate",
  page_size: "A4",
  orientation: "landscape",
  variables: [
    { key: "school_name", label: "School" }, { key: "recipient", label: "Recipient" },
    { key: "achievement", label: "Achievement" }, { key: "date", label: "Date" },
    { key: "signatory1", label: "Left Signatory" }, { key: "signatory2", label: "Right Signatory" },
  ],
  sample: {
    school_name: "Akoro Demo Academy", recipient: "Amara Nwosu",
    achievement: "outstanding academic excellence and exemplary conduct in the 2025/2026 session",
    date: "24 July 2026", signatory1: "Class Teacher", signatory2: "Principal",
  },
  css: `
.cert { border:6px double #C79A2E; padding:34px 44px; text-align:center; min-height:150mm; display:flex; flex-direction:column; justify-content:center; }
.cert .school { font-size:15pt; font-weight:bold; letter-spacing:1px; color:#0A2A5E; }
.cert .title { font-size:30pt; font-weight:900; color:#C79A2E; margin:14px 0 6px; letter-spacing:2px; }
.cert .presented { font-size:12pt; margin:8px 0; }
.cert .name { font-size:26pt; font-weight:800; margin:10px 0; border-bottom:1px solid #999; display:inline-block; padding:0 40px 6px; }
.cert .for { font-size:13pt; max-width:560px; margin:12px auto; line-height:1.6; }
.cert .sigs { display:flex; justify-content:space-between; margin-top:40px; }
.cert .sig { width:40%; border-top:1px solid #000; padding-top:6px; font-size:11pt; }`,
  body: `
<div class="cert">
  <div class="school">{{school_name}}</div>
  <div class="title">Certificate of Achievement</div>
  <div class="presented">This certificate is proudly presented to</div>
  <div class="name">{{recipient}}</div>
  <div class="for">for {{achievement}}.</div>
  <div class="sigs">
    <div class="sig">{{signatory1}}</div>
    <div class="sig">{{date}}</div>
    <div class="sig">{{signatory2}}</div>
  </div>
</div>`,
};
