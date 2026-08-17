// Collects email-list signups and forwards them to a Google Apps Script
// webhook that appends each address to a Google Sheet. Setup steps for the
// sheet, the script, and the SUBSCRIBE_WEBHOOK_URL env var live in
// SUBSCRIBE_SETUP.md.

const MAX_BODY_BYTES = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

// Vercel's Node runtime pre-parses JSON bodies into req.body; fall back to
// reading the stream so this also works under a bare Node server.
const getBody = async (req) => {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") {
      return req.body;
    }
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(await readBody(req));
  } catch {
    return {};
  }
};

const send = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const body = await getBody(req);

  // Honeypot: the form includes a visually hidden "website" field that
  // humans never fill in. Pretend success so bots move on.
  if (body.website) {
    send(res, 200, { ok: true });
    return;
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    send(res, 400, { ok: false, error: "Invalid email address" });
    return;
  }

  const webhook = process.env.SUBSCRIBE_WEBHOOK_URL;
  if (!webhook) {
    console.error("SUBSCRIBE_WEBHOOK_URL is not set");
    send(res, 500, { ok: false, error: "Subscriptions are not configured" });
    return;
  }

  try {
    const upstream = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        source: String(body.source ?? "").slice(0, 200),
      }),
    });
    if (!upstream.ok) {
      throw new Error(`Webhook responded ${upstream.status}`);
    }
    send(res, 200, { ok: true });
  } catch (error) {
    console.error("Subscribe webhook failed:", error);
    send(res, 502, {
      ok: false,
      error: "Could not save your email, please try again",
    });
  }
};
