-- =============================================================
-- 2026-seed-doc-templates.sql
-- Sample document template for the demo school: "Staff Annual Performance
-- Evaluation Report (Form B)" — recreated as HTML (tables, section headers,
-- dotted-line fields) so it renders and prints exactly like the paper form.
-- Idempotent (keyed by name). Demo data. Run after 2026-document-templates.sql.
-- =============================================================

DO $$
DECLARE v_school uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping doc template seed.'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM mgmt.document_templates WHERE school_id = v_school AND name = 'Staff Annual Performance Evaluation (Form B)') THEN RETURN; END IF;

  INSERT INTO mgmt.document_templates (school_id, name, description, category, page_size, orientation, variables, body)
  VALUES (
    v_school,
    'Staff Annual Performance Evaluation (Form B)',
    'Annual performance evaluation report — Part 1 personal records.',
    'form', 'A4', 'portrait',
    '[{"key":"period_from","label":"Period From"},{"key":"period_to","label":"Period To"},{"key":"surname","label":"Surname"},{"key":"forenames","label":"Forenames"},{"key":"ministry","label":"Ministry / Dept"},{"key":"department","label":"Department"},{"key":"division","label":"Division"},{"key":"branch","label":"Branch"},{"key":"section","label":"Section"},{"key":"dob","label":"Date of Birth"},{"key":"date_substantive","label":"Date Appointed to Substantive Post"},{"key":"first_appt","label":"Date of First Appointment"},{"key":"grade_level","label":"Grade Level"},{"key":"first_post","label":"Post of First Appointment"},{"key":"salary","label":"Salary per Annum"},{"key":"confirm_date","label":"Date of Confirmation"},{"key":"increment_date","label":"Date of Net Increment"},{"key":"present_post","label":"Present Substantive Post"},{"key":"appt_period","label":"Date of Appointment during Period"}]'::jsonb,
    $DOC$
<h1>Staff Annual Performance Evaluation Report &mdash; Form B</h1>
<p class="sub">(For Officers on Grade Level 03 and above)</p>
<p class="sub" style="font-style:italic">Note: This form should be processed to its first destination before the end of the 1st quarter of the succeeding year.</p>

<table class="plain" style="margin:10px 0 4px">
  <tr>
    <td style="width:60%;border:none;vertical-align:bottom">
      <b>PART 1</b><br><b>PERSONAL RECORDS OF OFFICER</b><br>
      <i>(To be completed by the Officer being reported upon)</i>
    </td>
    <td style="width:40%;padding:0">
      <table>
        <tr><th colspan="2" style="text-align:center">Period of Report</th></tr>
        <tr><th style="width:50%;text-align:center">From</th><th style="text-align:center">To</th></tr>
        <tr><td style="height:22px;text-align:center">{{period_from}}</td><td style="text-align:center">{{period_to}}</td></tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:16px 0 6px"><b>1.</b>&nbsp; Full Name of Officer (Block letters) &mdash; Surname first:</p>
<div class="row">Mr/Mrs/Miss <span class="fill" style="min-width:180px">{{surname}}</span> <span class="fill grow">{{forenames}}</span></div>
<table class="plain"><tr><td style="border:none;width:50%;text-align:center;font-size:10pt">Surname</td><td style="border:none;text-align:center;font-size:10pt">Forenames</td></tr></table>
<p style="font-size:10pt;font-style:italic;margin:4px 0 10px">(Delete whichever is not applicable)</p>

<div class="row">Ministry/Extra-Ministerial Department <span class="fill grow">{{ministry}}</span></div>
<div class="row">Department <span class="fill grow">{{department}}</span></div>
<div class="row">Division <span class="fill grow">{{division}}</span></div>
<div class="row">Branch <span class="fill grow">{{branch}}</span></div>
<div class="row">Section <span class="fill grow">{{section}}</span></div>

<p style="margin:16px 0 6px"><b>3 (A)</b>&nbsp; Personal Particulars</p>
<table>
  <tr><td style="width:50%">(a)&nbsp; Date of Birth<br><b>{{dob}}</b></td><td>(f)&nbsp; Date Appointed to Substantive Post<br><b>{{date_substantive}}</b></td></tr>
  <tr><td>(b)&nbsp; Date of first appointment in the service<br><b>{{first_appt}}</b></td><td>(g)&nbsp; Grade Level<br><b>{{grade_level}}</b></td></tr>
  <tr><td>(c)&nbsp; Post to which first appointed<br><b>{{first_post}}</b></td><td>(h)&nbsp; Salary per Annum<br><b>{{salary}}</b></td></tr>
  <tr><td>(d)&nbsp; Date of Confirmation<br><b>{{confirm_date}}</b></td><td>(i)&nbsp; Date of Net Increment<br><b>{{increment_date}}</b></td></tr>
  <tr><td>(e)&nbsp; Present Substantive Post<br><b>{{present_post}}</b></td><td>(j)&nbsp; Date of Appointment during the Period covered by the Report<br><b>{{appt_period}}</b></td></tr>
</table>

<p style="margin:16px 0 6px"><b>(B)</b>&nbsp; Qualifications held (Academic, Professional or technical)</p>
<table>
  <tr><th style="width:70%;text-align:left">Qualification</th><th style="text-align:left">Year Obtained</th></tr>
  <tr><td style="height:26px">(i)&nbsp; {{qual1}}</td><td>{{year1}}</td></tr>
  <tr><td style="height:26px">(ii)&nbsp; {{qual2}}</td><td>{{year2}}</td></tr>
  <tr><td style="height:26px">(iii)&nbsp; {{qual3}}</td><td>{{year3}}</td></tr>
  <tr><td style="height:26px">(iv)&nbsp; {{qual4}}</td><td>{{year4}}</td></tr>
  <tr><td style="height:26px">(v)&nbsp; {{qual5}}</td><td>{{year5}}</td></tr>
</table>
$DOC$
  );
END $$;
