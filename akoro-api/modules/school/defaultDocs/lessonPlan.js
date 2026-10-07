export default {
  id: "lesson-plan",
  name: "Lesson Plan",
  description: "Standard lesson plan with objectives and staged activities.",
  category: "form",
  page_size: "A4",
  orientation: "portrait",
  variables: [
    { key: "school_name", label: "School" }, { key: "teacher", label: "Teacher" },
    { key: "subject", label: "Subject" }, { key: "class", label: "Class" },
    { key: "date", label: "Date" }, { key: "duration", label: "Duration" },
    { key: "topic", label: "Topic" }, { key: "objectives", label: "Objectives" },
    { key: "materials", label: "Materials" }, { key: "assessment", label: "Assessment" },
    { key: "homework", label: "Homework" },
  ],
  sample: {
    school_name: "Akoro Demo Academy", teacher: "Mrs. O. Bello", subject: "Basic Science",
    class: "JSS 1", date: "12 May 2026", duration: "40 mins", topic: "States of Matter",
    objectives: "By the end of the lesson, students will identify the three states of matter and give examples of each.",
    materials: "Water, ice, kettle, balloons, chart of particle arrangement.",
    assessment: "Oral questions + a 5-item exit quiz.", homework: "List 5 solids, 5 liquids and 5 gases at home.",
  },
  body: `
<h1>Lesson Plan</h1>
<p class="sub">{{school_name}}</p>
<table class="plain" style="margin:8px 0 6px">
  <tr><td style="border:none">Teacher: <b>{{teacher}}</b></td><td style="border:none">Subject: <b>{{subject}}</b></td><td style="border:none">Class: <b>{{class}}</b></td></tr>
  <tr><td style="border:none">Date: <b>{{date}}</b></td><td style="border:none">Duration: <b>{{duration}}</b></td><td style="border:none">Topic: <b>{{topic}}</b></td></tr>
</table>
<h3>Learning Objectives</h3>
<div class="row"><span class="grow" style="min-height:34px">{{objectives}}</span></div>
<h3>Instructional Materials</h3>
<div class="row"><span class="grow" style="min-height:28px">{{materials}}</span></div>
<h3>Lesson Development</h3>
<table>
  <tr><th style="width:18%">Time</th><th style="width:41%">Teacher's Activity</th><th style="width:41%">Students' Activity</th></tr>
  <tr><td style="height:34px">Introduction</td><td></td><td></td></tr>
  <tr><td style="height:44px">Presentation</td><td></td><td></td></tr>
  <tr><td style="height:44px">Evaluation</td><td></td><td></td></tr>
  <tr><td style="height:34px">Conclusion</td><td></td><td></td></tr>
</table>
<h3>Assessment</h3>
<div class="row"><span class="grow" style="min-height:28px">{{assessment}}</span></div>
<h3>Assignment / Homework</h3>
<div class="row"><span class="grow" style="min-height:28px">{{homework}}</span></div>
<table class="plain" style="margin-top:24px"><tr>
  <td style="border:none">Teacher's Signature: <span class="fill">&nbsp;</span></td>
  <td style="border:none;text-align:right">Head Teacher: <span class="fill">&nbsp;</span></td>
</tr></table>`,
};
