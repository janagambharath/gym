// WhatsApp recent-message log API — parity with the PWA WhatsApp screen.
//
// Endpoint verified against the backend (app/mobile_api/whatsapp.py):
//   GET /api/mobile/v1/whatsapp/logs?page_size=20
//   Returns { logs: [{ id, member_id, member_name, phone, template,
//   message_type, status, sent_at, created_at }] } — the same ReminderLog
//   rows as /whatsapp/reminders, shaped for the PWA.
// The PWA fetches page_size=20 and renders the first 15
// (renewal-desk-pwa/src/screens/whatsapp.js); Android does the same.

import type { ApiResult, apiRequest } from './apiClient';

/** Injectable request function — screens pass the real `apiRequest`. */
export type WhatsAppLogRequestFn = typeof apiRequest;

/** How many recent messages the log shows, matching the PWA (slice 0,15). */
export const RECENT_MESSAGE_LIMIT = 15;

export type WhatsAppLogEntry = {
  id: number;
  member_id: number | null;
  member_name: string | null;
  phone: string | null;
  template: string | null;
  message_type: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string | null;
};

type WhatsAppLogsResponse = {
  logs?: WhatsAppLogEntry[];
  /** Fallback key the PWA also accepts. */
  messages?: WhatsAppLogEntry[];
};

export function whatsappLogsPath(pageSize = 20): string {
  return `/api/mobile/v1/whatsapp/logs?page_size=${pageSize}`;
}

/** Keep only the most recent `limit` entries, newest first (backend order). */
export function recentMessages(
  logs: WhatsAppLogEntry[] | null | undefined,
  limit: number = RECENT_MESSAGE_LIMIT,
): WhatsAppLogEntry[] {
  return (logs ?? []).slice(0, limit);
}

/** PWA display fallbacks: member name → phone → 'Unknown'. */
export function logDisplayName(entry: WhatsAppLogEntry): string {
  return entry.member_name || entry.phone || 'Unknown';
}

/** PWA display fallbacks: template → message type → 'Message'. */
export function logDisplayTemplate(entry: WhatsAppLogEntry): string {
  return entry.template || entry.message_type || 'Message';
}

/** Fetch the log and return at most `limit` most recent messages. */
export async function fetchRecentWhatsAppMessages(
  request: WhatsAppLogRequestFn,
  limit: number = RECENT_MESSAGE_LIMIT,
): Promise<ApiResult<WhatsAppLogEntry[]>> {
  const res = await request<WhatsAppLogsResponse>(whatsappLogsPath(20));
  if (!res.ok) {
    return res;
  }
  const logs = res.data.logs ?? res.data.messages ?? [];
  return { ok: true, data: recentMessages(logs, limit) };
}
