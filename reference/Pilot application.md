<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Apply for the Akoro Pilot Programme</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --purple: #6C3BFF; --purple-dark: #5A2FE0; --purple-soft: #F1ECFF;
    --coral: #FF6B57; --green: #2BB673; --green-soft: #E7F8EF;
    --bg: #FAFAFC; --surface: #FFFFFF; --border: #E7E4F0;
    --text: #221D33; --text-dim: #6B667E;
    box-sizing: border-box; padding-top: env(safe-area-inset-top,0px); padding-bottom: env(safe-area-inset-bottom,0px);
  }
  :root[data-theme="dark"] { --bg:#17151F; --surface:#211E2C; --border:#322E40; --text:#F1EFF7; --text-dim:#A29CB8; --purple-soft:#2A2140; --green-soft:#16302344; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:'Nunito',system-ui,sans-serif; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 48px 24px 64px; }
  .brand { font-weight:900; font-size:1.3rem; color:var(--purple); margin-bottom:28px; }
  h1 { font-size:2rem; font-weight:900; line-height:1.15; margin:0 0 12px; }
  .lede { color:var(--text-dim); font-size:1.05rem; line-height:1.5; margin:0 0 28px; }
  .perks { display:flex; flex-direction:column; gap:10px; margin-bottom:36px; }
  .perk { display:flex; gap:10px; align-items:flex-start; font-size:0.95rem; font-weight:600; }
  .perk .dot { flex-shrink:0; width:20px; height:20px; border-radius:50%; background:var(--green-soft); color:var(--green); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:900; margin-top:1px; }

  form { background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:28px 26px; }
  .field { margin-bottom:18px; }
  .field label { display:block; font-size:0.85rem; font-weight:700; margin-bottom:6px; }
  .field .hint { font-weight:600; color:var(--text-dim); font-size:0.78rem; }
  .field input, .field textarea, .field select {
    width:100%; padding:11px 14px; border-radius:12px; border:1px solid var(--border);
    background:var(--bg); color:var(--text); font-family:inherit; font-size:0.95rem;
  }
  .field input:focus, .field textarea:focus, .field select:focus { outline:2px solid var(--purple); outline-offset:1px; }
  .field textarea { resize:vertical; min-height:90px; }
  .field-row { display:flex; gap:12px; }
  .field-row .field { flex:1; }
  .error { color:var(--coral); font-size:0.8rem; font-weight:700; margin-top:5px; display:none; }
  .field.invalid input, .field.invalid textarea { border-color:var(--coral); }
  .field.invalid .error { display:block; }

  .submit-btn { width:100%; padding:15px; border-radius:100px; border:none; background:var(--purple); color:white; font-family:inherit; font-weight:800; font-size:1rem; cursor:pointer; margin-top:6px; }
  .submit-btn:hover { background:var(--purple-dark); }
  .fine-print { font-size:0.78rem; color:var(--text-dim); text-align:center; margin-top:14px; line-height:1.4; }

  .success { display:none; text-align:center; padding:50px 26px; background:var(--surface); border:1px solid var(--border); border-radius:20px; }
  .success .icon { width:60px; height:60px; border-radius:50%; background:var(--green-soft); color:var(--green); display:flex; align-items:center; justify-content:center; font-size:1.8rem; margin:0 auto 18px; }
  .success h2 { font-size:1.3rem; font-weight:900; margin:0 0 10px; }
  .success p { color:var(--text-dim); line-height:1.5; margin:0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Akoro</div>

  <div id="form-view">
    <h1>Bring Akoro to your school</h1>
    <p class="lede">Apply for our free pilot programme and give your teachers and students full access to Akoro's AI learning tools for a month, at no cost.</p>

    <div class="perks">
      <div class="perk"><span class="dot">✓</span> Free access for every instructor and student during the pilot</div>
      <div class="perk"><span class="dot">✓</span> A free school website, built in from day one</div>
      <div class="perk"><span class="dot">✓</span> Hands-on onboarding support for your teaching staff</div>
      <div class="perk"><span class="dot">✓</span> No commitment — decide whether to continue once the pilot ends</div>
    </div>

    <form id="pilot-form" onsubmit="return submitApplication(event)">
      <div class="field" id="f-school">
        <label for="schoolName">School name</label>
        <input type="text" id="schoolName" placeholder="e.g. Chrisland College">
        <div class="error">Enter your school's name</div>
      </div>

      <div class="field-row">
        <div class="field" id="f-state">
          <label for="state">State / City</label>
          <input type="text" id="state" placeholder="e.g. Lagos">
        </div>
        <div class="field" id="f-students">
          <label for="estStudents">Estimated students</label>
          <input type="number" min="1" id="estStudents" placeholder="e.g. 150">
          <div class="error">Enter an estimated number of students</div>
        </div>
      </div>

      <div class="field" id="f-contact">
        <label for="contactName">Your name</label>
        <input type="text" id="contactName" placeholder="e.g. Mrs. Folake Adeyemi">
        <div class="error">Enter your name</div>
      </div>

      <div class="field-row">
        <div class="field" id="f-email">
          <label for="contactEmail">Email</label>
          <input type="email" id="contactEmail" placeholder="you@school.com">
          <div class="error">Enter a valid email address</div>
        </div>
        <div class="field" id="f-phone">
          <label for="contactPhone">Phone</label>
          <input type="text" id="contactPhone" placeholder="+234 800 000 0000">
          <div class="error">Enter a phone number</div>
        </div>
      </div>

      <div class="field" id="f-message">
        <label for="message">Tell us about your school <span class="hint">(optional)</span></label>
        <textarea id="message" placeholder="What grade levels do you teach, and why are you interested in Akoro?"></textarea>
      </div>

      <button type="submit" class="submit-btn">Submit application</button>
      <p class="fine-print">Our team reviews applications and typically responds within a few days.</p>
    </form>
  </div>

  <div class="success" id="success-view">
    <div class="icon">✓</div>
    <h2>Application received</h2>
    <p>Thanks for applying to the Akoro pilot programme. Our team will review your details and reach out by email within a few days.</p>
  </div>
</div>

<script>
  function setInvalid(fieldId, invalid){
    document.getElementById(fieldId).classList.toggle('invalid', invalid);
  }

  function submitApplication(e){
    e.preventDefault();
    const schoolName = document.getElementById('schoolName').value;
    const estStudents = document.getElementById('estStudents').value;
    const contactName = document.getElementById('contactName').value;
    const contactEmail = document.getElementById('contactEmail').value;
    const contactPhone = document.getElementById('contactPhone').value;

    let ok = true;
    setInvalid('f-school', !schoolName.trim()); if (!schoolName.trim()) ok = false;
    setInvalid('f-students', !(Number(estStudents) > 0)); if (!(Number(estStudents) > 0)) ok = false;
    setInvalid('f-contact', !contactName.trim()); if (!contactName.trim()) ok = false;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
    setInvalid('f-email', !emailOk); if (!emailOk) ok = false;
    setInvalid('f-phone', contactPhone.trim().length < 7); if (contactPhone.trim().length < 7) ok = false;

    if (!ok) return false;

    document.getElementById('form-view').style.display = 'none';
    document.getElementById('success-view').style.display = 'block';
    return false;
  }
</script>
</body>
</html>
