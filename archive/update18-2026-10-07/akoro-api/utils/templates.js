/**
 * utils/templates.js  —  Piabam Notification Templates
 *
 * Returns { email: { subject, html, text }, sms: { body }, push: { title, body } }
 * for every notification type.
 *
 * Usage:
 *   import { getEmailTemplate } from "../utils/templates.js";
 *   const content = getEmailTemplate("session_started", { sessionTitle, meetingUrl, userName });
 */

const baseHtml = (bodyContent) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: 'DM Sans', Arial, sans-serif; background: #FAF8F5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 32px auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #EDE8E1; }
    .header { background: linear-gradient(135deg, #1A1A2E, #1C2340); padding: 28px 32px; text-align: center; }
    .header h1 { color: #fff; font-size: 22px; margin: 0; }
    .header p  { color: rgba(255,255,255,0.55); font-size: 13px; margin: 6px 0 0; }
    .body   { padding: 28px 32px; }
    .body p { color: #3A3A4A; font-size: 14px; line-height: 1.65; }
    .cta    { display: block; width: fit-content; margin: 20px auto; padding: 13px 28px; background: #E8884A; color: #fff; border-radius: 100px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .detail { background: #FAF8F5; border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
    .detail p { margin: 4px 0; font-size: 13px; color: #6B6B80; }
    .footer { border-top: 1px solid #EDE8E1; padding: 16px 32px; text-align: center; }
    .footer p { font-size: 11px; color: #9490A0; margin: 0; }
    .badge  { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
    .live   { background: #FEE2E2; color: #EF4444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Akoro Learning</h1>
      <p>Your personalised learning platform</p>
    </div>
    ${bodyContent}
    <div class="footer">
      <p>You received this because you are enrolled on Piabam. <a href="#" style="color:#E8884A">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>`;

export const getEmailTemplate = (type, data = {}) => {
  const { sessionTitle, courseTitle, meetingUrl, recordingUrl, instructor, userName = "Student" } = data;

  const templates = {

    session_created: {
      email: {
        subject: `📚 New live session: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>A new live session has been scheduled for <strong>${courseTitle}</strong>.</p>
            <div class="detail">
              <p><strong>Session:</strong> ${sessionTitle}</p>
              <p><strong>Instructor:</strong> ${instructor?.name ?? "Your instructor"}</p>
            </div>
            <p>You've been automatically registered. We'll remind you before it starts.</p>
            <a class="cta" href="${meetingUrl ?? "#"}">View session details →</a>
          </div>`),
        text: `New session: "${sessionTitle}" for ${courseTitle}. Join: ${meetingUrl}`,
      },
      sms:  { body: `Piabam: New session "${sessionTitle}" scheduled in ${courseTitle}. Check the app for details.` },
      push: { title: "New Live Session!", body: `${sessionTitle} · ${courseTitle}` },
    },

    reminder_24h: {
      email: {
        subject: `⏰ Reminder: ${sessionTitle} starts in 24 hours`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>Don't forget — <strong>${sessionTitle}</strong> starts in <strong>24 hours</strong>.</p>
            <div class="detail">
              <p><strong>Course:</strong> ${courseTitle}</p>
              <p><strong>Instructor:</strong> ${instructor?.name ?? "Your instructor"}</p>
            </div>
            <a class="cta" href="${meetingUrl ?? "#"}">Get ready to join →</a>
          </div>`),
        text: `Reminder: "${sessionTitle}" starts in 24 hours. Join: ${meetingUrl}`,
      },
      sms:  { body: `Piabam Reminder: "${sessionTitle}" starts in 24 hours. Join: ${meetingUrl}` },
      push: { title: "Session Tomorrow!", body: `${sessionTitle} starts in 24 hours` },
    },

    reminder_1h: {
      email: {
        subject: `🔔 Starting in 1 hour: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p><strong>${sessionTitle}</strong> is starting in <strong>1 hour</strong>. Get ready!</p>
            <a class="cta" href="${meetingUrl ?? "#"}">Join session →</a>
          </div>`),
        text: `"${sessionTitle}" starts in 1 hour! Join: ${meetingUrl}`,
      },
      sms:  { body: `Piabam: "${sessionTitle}" starts in 1 hour. Join: ${meetingUrl}` },
      push: { title: "Starting in 1 Hour!", body: `${sessionTitle} · Click to prepare` },
    },

    reminder_10min: {
      email: {
        subject: `🚀 Starting NOW: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p><strong>${sessionTitle}</strong> is starting in <strong>10 minutes</strong>!</p>
            <a class="cta" href="${meetingUrl ?? "#"}">Join now →</a>
          </div>`),
        text: `"${sessionTitle}" starts in 10 minutes! Join now: ${meetingUrl}`,
      },
      sms:  { body: `Piabam: "${sessionTitle}" starts in 10 min! Join NOW: ${meetingUrl}` },
      push: { title: "Starting in 10 Minutes!", body: `Join ${sessionTitle} now →` },
    },

    session_started: {
      email: {
        subject: `🔴 LIVE NOW: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p><span class="badge live">🔴 LIVE</span> <strong>${sessionTitle}</strong> is happening right now!</p>
            <a class="cta" href="${meetingUrl ?? "#"}">Join live session →</a>
          </div>`),
        text: `LIVE NOW: "${sessionTitle}". Join: ${meetingUrl}`,
      },
      sms:  { body: `🔴 LIVE: "${sessionTitle}" is happening NOW! Join: ${meetingUrl}` },
      push: { title: "🔴 LIVE NOW!", body: `${sessionTitle} is live. Join now!` },
    },

    recording_available: {
      email: {
        subject: `📹 Recording ready: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>The recording for <strong>${sessionTitle}</strong> is now available to watch.</p>
            <a class="cta" href="${recordingUrl ?? "#"}">Watch recording →</a>
          </div>`),
        text: `Recording for "${sessionTitle}" is ready: ${recordingUrl}`,
      },
      sms:  { body: `Piabam: Recording for "${sessionTitle}" is ready. Watch: ${recordingUrl}` },
      push: { title: "Recording Available", body: `Watch ${sessionTitle} recording now` },
    },

    session_cancelled: {
      email: {
        subject: `⚠️ Session Cancelled: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>Unfortunately, <strong>${sessionTitle}</strong> has been cancelled.</p>
            <p>Please check the app for any rescheduled dates or refund information.</p>
          </div>`),
        text: `Session "${sessionTitle}" has been cancelled. Check the app for details.`,
      },
      sms:  { body: `Piabam: Session "${sessionTitle}" has been cancelled. Check the app.` },
      push: { title: "Session Cancelled", body: `${sessionTitle} has been cancelled` },
    },

    new_announcement: {
      email: {
        subject: `📢 ${data.announcementTitle ?? "New announcement"} — ${courseTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>Your instructor posted a new announcement in <strong>${courseTitle}</strong>.</p>
            <div class="detail">
              <p><strong>${data.announcementTitle ?? ""}</strong></p>
              <p>${data.announcementContent ?? ""}</p>
            </div>
          </div>`),
        text: `New announcement in ${courseTitle}: ${data.announcementTitle}`,
      },
      sms:  { body: `Piabam: New announcement in "${courseTitle}": ${data.announcementTitle}` },
      push: { title: "New Announcement", body: `${courseTitle}: ${data.announcementTitle}` },
    },

    qa_reply: {
      email: {
        subject: `💬 New reply to your question`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>Someone replied to your question <strong>"${data.questionTitle ?? ""}"</strong>.</p>
            <div class="detail"><p>${data.replyContent ?? ""}</p></div>
          </div>`),
        text: `New reply to your question "${data.questionTitle}": ${data.replyContent}`,
      },
      sms:  { body: `Piabam: New reply to your question "${data.questionTitle}". Check the app.` },
      push: { title: "New Reply!", body: `Someone answered your question` },
    },

    waitlist_available: {
      email: {
        subject: `🎉 Spot available: ${sessionTitle}`,
        html: baseHtml(`
          <div class="body">
            <p>Hi ${userName},</p>
            <p>Good news! A spot has opened up in <strong>${sessionTitle}</strong>.</p>
            <a class="cta" href="${meetingUrl ?? "#"}">Join now before it fills up →</a>
          </div>`),
        text: `Spot available in "${sessionTitle}". Join: ${meetingUrl}`,
      },
      sms:  { body: `Piabam: A spot opened in "${sessionTitle}"! Join now: ${meetingUrl}` },
      push: { title: "Spot Available!", body: `Join ${sessionTitle} now →` },
    },
  };

  return templates[type] ?? templates["reminder_1h"];
};
