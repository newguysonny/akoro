export default {
  id: "worksheet",
  name: "Worksheet",
  description: "Classwork / practice worksheet with questions and answer lines.",
  category: "form",
  page_size: "A4",
  orientation: "portrait",
  variables: [
    { key: "school_name", label: "School" }, { key: "subject", label: "Subject" },
    { key: "topic", label: "Topic" }, { key: "class", label: "Class" },
    { key: "name", label: "Student Name" }, { key: "date", label: "Date" },
    { key: "instructions", label: "Instructions" },
  ],
  sample: {
    school_name: "Akoro Demo Academy", subject: "Mathematics", topic: "Fractions",
    class: "Primary 5", name: "", date: "", instructions: "Answer all questions. Show your working clearly.",
  },
  body: `
<h1>Worksheet</h1>
<p class="sub">{{school_name}} &mdash; {{subject}}: {{topic}}</p>
<table class="plain" style="margin:8px 0 10px">
  <tr><td style="border:none">Name: <span class="fill" style="min-width:220px">{{name}}</span></td><td style="border:none">Class: <span class="fill">{{class}}</span></td><td style="border:none">Date: <span class="fill">{{date}}</span></td></tr>
</table>
<p style="margin:0 0 12px"><b>Instructions:</b> {{instructions}}</p>
<ol style="padding-left:20px;line-height:2.4">
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
  <li>_______________________________________________________________</li>
</ol>
<table class="plain" style="margin-top:20px"><tr>
  <td style="border:1px solid #000;width:160px;text-align:center;padding:10px">Score<br><br>_____ / _____</td>
  <td style="border:none;text-align:right;vertical-align:bottom">Teacher's Signature: <span class="fill">&nbsp;</span></td>
</tr></table>`,
};
