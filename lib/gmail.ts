const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch Google account email: ${response.status} ${body}`);
  }
  const data = (await response.json()) as { email?: string };
  if (!data.email) throw new Error("Google account has no email address on file.");
  return data.email;
}

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

function encodeHeaderWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

function buildMimeMessage(params: {
  to: string;
  subject: string;
  bodyText: string;
  attachments: EmailAttachment[];
}): string {
  const boundary = `reconciliator_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `To: ${params.to}`,
    `Subject: ${encodeHeaderWord(params.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.bodyText,
    "",
  ];

  for (const attachment of params.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.content.toString("base64").replace(/(.{76})/g, "$1\n"),
      ""
    );
  }

  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmailWithAttachments(
  accessToken: string,
  params: { to: string; subject: string; bodyText: string; attachments: EmailAttachment[] }
): Promise<void> {
  const raw = toBase64Url(buildMimeMessage(params));
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gmail API send failed: ${response.status} ${body}`);
  }
}
