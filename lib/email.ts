import type { MailAdapter } from "./execute";

export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

export function resendMailAdapter(
  apiKey: string,
  from: string,
): MailAdapter {
  return {
    async sendReply(to: string, subject: string, text: string): Promise<void> {
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, text }),
        });
      } catch (e) {
        throw new Error(`email send failed: ${(e as Error).message}`);
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`email send failed (HTTP ${res.status}): ${detail}`);
      }
    },
  };
}
