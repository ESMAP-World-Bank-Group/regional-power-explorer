/**
 * Regional Power Explorer — "Request a feature/dataset" backend
 * Google Apps Script: appends each request to a Google Sheet + emails a notification.
 *
 * ── SETUP (one-time, ~5 min) ────────────────────────────────────────────────
 * 1. Create a Google Sheet (e.g. "RPE — Requests"). Optionally add a tab named
 *    "Requests" (otherwise the first sheet is used).
 * 2. In that Sheet: Extensions → Apps Script. Delete the placeholder, paste this
 *    whole file. Set NOTIFY_EMAIL below to your address.
 * 3. Deploy → New deployment → gear icon → "Web app".
 *      - Description: RPE requests
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    → Deploy → Authorize (allow the script to use the Sheet + send mail).
 * 4. Copy the Web app URL (ends with /exec).
 * 5. Paste it into GOOGLE_APPS_SCRIPT_URL in src/pages/ContactPage.jsx
 *    (or send it to me and I'll set it). Done — submissions now land in the Sheet
 *    and you get an email each time.
 *
 * Note: the frontend posts with mode:'no-cors' (form-urlencoded), so no CORS
 * headers are needed here.
 */

var NOTIFY_EMAIL = 'mbaronnet@worldbank.org';   // ← set your address

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Requests') || ss.getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Name', 'Email', 'Request', 'Source']);
    }
    sheet.appendRow([
      new Date(),
      p.name || '',
      p.email || '',
      p.request || '',
      p.source || '',
    ]);

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'New request — Regional Power Explorer',
        replyTo: p.email || NOTIFY_EMAIL,
        body: 'Name:  ' + (p.name || '—') +
              '\nEmail: ' + (p.email || '—') +
              '\n\nRequest:\n' + (p.request || '') +
              '\n\nSource: ' + (p.source || ''),
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
