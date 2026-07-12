import { get, put } from "@vercel/blob";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, 405, { error: "method_not_allowed" });
  }

  try {
    const body = await readJson(request);
    const inviteHash = sanitizeHash(body.inviteHash);
    if (!inviteHash) return send(response, 400, { error: "invalid_invite" });

    const pathname = `journal-sync/${inviteHash}.json`;

    if (body.mode === "load") {
      const record = await loadRecord(pathname);
      return send(response, 200, { record });
    }

    if (body.mode === "save") {
      if (!body.payload || !Array.isArray(body.payload.trips)) {
        return send(response, 400, { error: "invalid_payload" });
      }
      const record = {
        inviteHash,
        clientId: String(body.clientId || ""),
        payload: body.payload,
        updatedAt: new Date().toISOString()
      };
      const blob = await put(pathname, JSON.stringify(record), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json"
      });
      return send(response, 200, {
        record: {
          payload: record.payload,
          clientId: record.clientId,
          updatedAt: record.updatedAt,
          pathname: blob.pathname
        }
      });
    }

    return send(response, 400, { error: "invalid_mode" });
  } catch (error) {
    const message = error?.message || "sync_failed";
    const status = /not found/i.test(message) ? 200 : 500;
    return send(response, status, { error: message });
  }
}

async function loadRecord(pathname) {
  try {
    const blob = await get(pathname, { access: "private" });
    const result = await fetch(blob.downloadUrl || blob.url);
    if (!result.ok) return null;
    return result.json();
  } catch (error) {
    if (/not found|404/i.test(error?.message || "")) return null;
    throw error;
  }
}

function sanitizeHash(value) {
  const text = String(value || "").trim();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function send(response, status, data) {
  response.statusCode = status;
  Object.entries(JSON_HEADERS).forEach(([key, value]) => response.setHeader(key, value));
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", chunk => {
      raw += chunk;
      if (raw.length > 4_500_000) {
        request.destroy();
        reject(new Error("payload_too_large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}
