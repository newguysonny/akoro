export default {
  id: "report-card",
  name: "Report Card",
  description: "Termly student report card with subject scores and remarks.",
  category: "result",
  page_size: "A4",
  orientation: "portrait",
  variables: [
    { key: "school_name", label: "School" }, { key: "term", label: "Term / Session" },
    { key: "student", label: "Student Name" }, { key: "admission_no", label: "Admission No" },
    { key: "class", label: "Class" }, { key: "position", label: "Position" },
    { key: "average", label: "Average" }, { key: "teacher_remark", label: "Teacher's Remark" },
    { key: "principal_remark", label: "Principal's Remark" },
  ],
  sample: {
    school_name: "Akoro Demo Academy", term: "First Term, 2025/2026", student: "Chidi Okafor",
    admission_no: "ADM-0042", class: "JSS 2A", position: "3rd", average: "78%",
    teacher_remark: "A hardworking and focused student. Keep it up.",
    principal_remark: "An excellent result. Well done.",
  },
  body: `
<h1>{{school_name}}</h1>
<p class="sub">Student Report Card &mdash; {{term}}</p>
<table class="plain" style="margin:8px 0">
  <tr><td style="border:none">Name: <b>{{student}}</b></td><td style="border:none">Admission No: <b>{{admission_no}}</b></td><td style="border:none">Class: <b>{{class}}</b></td></tr>
</table>
<table>
  <tr><th style="text-align:left">Subject</th><th>CA (40)</th><th>Exam (60)</th><th>Total (100)</th><th>Grade</th><th style="text-align:left">Remark</th></tr>
  <tr><td style="height:26px;text-align:left">English Language</td><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td style="height:26px;text-align:left">Mathematics</td><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td style="height:26px;text-align:left">Basic Science</td><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td style="height:26px;text-align:left">Social Studies</td><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td style="height:26px;text-align:left">Computer Studies</td><td></td><td></td><td></td><td></td><td></td></tr>
</table>
<table class="plain" style="margin:10px 0">
  <tr><td style="border:none">Average: <b>{{average}}</b></td><td style="border:none">Position in Class: <b>{{position}}</b></td></tr>
</table>
<h3>Class Teacher's Remark</h3>
<div class="row"><span class="grow" style="min-height:26px">{{teacher_remark}}</span></div>
<h3>Principal's Remark</h3>
<div class="row"><span class="grow" style="min-height:26px">{{principal_remark}}</span></div>
<table class="plain" style="margin-top:24px"><tr>
  <td style="border:none">Teacher's Signature: <span class="fill">&nbsp;</span></td>
  <td style="border:none;text-align:right">Principal's Signature: <span class="fill">&nbsp;</span></td>
</tr></table>`,
};
