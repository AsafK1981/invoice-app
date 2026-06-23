// Minimal MIME body decoder shared by the email helper/E2E scripts.
// Handles quoted-printable + base64 transfer encodings and per-part
// charsets (including windows-1255, which Node's TextDecoder supports
// natively via ICU). The pattern: capture raw bytes, then decode using
// the declared charset — never assume UTF-8.

export function decodeQPBytes(s) {
  // Quoted-printable -> raw bytes (returned as a Buffer so the caller can
  // re-decode with the declared charset).
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "=") {
      const next2 = s.slice(i + 1, i + 3);
      if (next2 === "\r\n" || next2.startsWith("\n")) {
        i += next2 === "\r\n" ? 2 : 1;
        continue;
      }
      if (/^[0-9A-Fa-f]{2}$/.test(next2)) {
        out.push(parseInt(next2, 16));
        i += 2;
        continue;
      }
      out.push(ch.charCodeAt(0));
    } else {
      out.push(ch.charCodeAt(0));
    }
  }
  return Buffer.from(out);
}

export function decodeBase64(s) {
  return Buffer.from(s.replace(/\s+/g, ""), "base64");
}

export function decodeBytes(buf, charset) {
  try {
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

export function partCharset(headers) {
  const m = headers.match(/charset="?([^";\r\n]+)"?/i);
  return m ? m[1].toLowerCase().trim() : null;
}

export function partXfer(headers) {
  const m = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Decode a single MIME part (or a whole non-multipart message). Returns
// { text, headers }. CR/LF endings vary (Gmail CRLF, gov.il sometimes LF),
// so the header/body separator length is measured, not assumed.
export function decodePart(rawPart) {
  const sepMatch = rawPart.match(/\r?\n\r?\n/);
  const headerEnd = sepMatch ? sepMatch.index : -1;
  const sepLen = sepMatch ? sepMatch[0].length : 0;
  const headers = headerEnd >= 0 ? rawPart.slice(0, headerEnd) : "";
  const body = headerEnd >= 0 ? rawPart.slice(headerEnd + sepLen) : rawPart;
  const xfer = partXfer(headers);
  const cs = partCharset(headers) || "utf-8";

  let bytes;
  if (xfer === "base64") bytes = decodeBase64(body);
  else if (xfer === "quoted-printable") bytes = decodeQPBytes(body);
  else bytes = Buffer.from(body, "latin1");

  return { text: decodeBytes(bytes, cs), headers };
}

// Decode every text/* part of a (possibly multipart) message and return
// the concatenated, tag-stripped text. Use this when you need to search
// the full human-readable content (e.g. E2E assertions), not just the
// preferred single part.
export function decodeAllText(raw) {
  const top = decodePart(raw);
  const boundaryM = top.headers.match(
    /Content-Type:\s*multipart\/[^;]+;\s*boundary="?([^"\r\n]+)"?/i,
  );
  if (!boundaryM) return stripTags(top.text);

  const sepMatch = raw.match(/\r?\n\r?\n/);
  const headerEnd = sepMatch ? sepMatch.index : -1;
  const sepLen = sepMatch ? sepMatch[0].length : 0;
  const rawBody = headerEnd >= 0 ? raw.slice(headerEnd + sepLen) : raw;

  const decoded = rawBody
    .split(`--${boundaryM[1]}`)
    .filter((p) => /Content-Type:\s*text\//i.test(p))
    .map((p) => decodePart(p).text)
    .join("\n");
  return stripTags(decoded || top.text);
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}
