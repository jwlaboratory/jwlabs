# Email list setup (Google Sheets)

The site has a subscribe form (homepage "Updates" section and the bottom of
every post). Submissions go to `/api/subscribe`, which validates the email and
forwards it to a Google Apps Script webhook that appends a row to a Google
Sheet. One-time setup:

## 1. Create the sheet + script

1. Go to <https://sheets.new> and name the spreadsheet (e.g. "JW Labs email list").
2. In the sheet: **Extensions → Apps Script**.
3. Delete the placeholder code and paste this:

```javascript
const SHEET_NAME = "Subscribers";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const data = JSON.parse(e.postData.contents);
    const email = String(data.email || "").trim().toLowerCase();
    if (!email) {
      return json({ ok: false });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["email", "subscribed_at", "source"]);
    }

    const existing = sheet
      .getRange(1, 1, sheet.getLastRow(), 1)
      .getValues()
      .flat();
    if (existing.includes(email)) {
      return json({ ok: true, duplicate: true });
    }

    sheet.appendRow([email, new Date(), String(data.source || "")]);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
```

4. Click **Deploy → New deployment**, gear icon → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (required so the Vercel function can POST to
     it; the URL is an unguessable secret and it only ever appends emails)
5. Authorize when prompted, then copy the **Web app URL**
   (`https://script.google.com/macros/s/…/exec`).

## 2. Point Vercel at it

In the Vercel dashboard → project → **Settings → Environment Variables**, add:

- Name: `SUBSCRIBE_WEBHOOK_URL`
- Value: the Web app URL from step 5
- Environments: Production (and Preview if you want)

Then redeploy (any new deployment picks it up).

## 3. Verify

<!-- Do NOT paste the actual webhook URL in this file — the repo is public,
     and anyone with the URL can write rows to the sheet directly. It belongs
     only in the Vercel env var. -->

```bash
curl -X POST https://<your-domain>/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","source":"curl"}'
```

Expect `{"ok":true}` and a new row in the "Subscribers" tab of the sheet.

## Notes

- Duplicate emails are silently deduped in the Apps Script (still returns
  `ok: true` so the visitor sees "Subscribed").
- The form has a hidden honeypot field; submissions that fill it are dropped
  server-side without touching the sheet.
- If you later edit the Apps Script code, use **Deploy → Manage deployments →
  edit → New version** — creating a brand-new deployment changes the URL and
  you'd have to update the env var.
- When you eventually want to send to the list, export the sheet as CSV and
  import into any newsletter tool (Buttondown, Resend, etc.).
