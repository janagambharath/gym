// Headers for the multipart payment-QR upload (V9-L16).
//
// Pure helpers, free of react-native / expo imports so the idempotency
// rule can be covered by node tests — same reason memberApiHeaders.ts
// exists for the member JSON client.
//
// V9-L16: uploadPaymentQrImage used to send no Idempotency-Key, and the
// 401-refresh retry re-POSTed the same FormData keyless. The backend
// honours the key for QR uploads since v8 (scope `payment_qr_upload`,
// fingerprint = SHA-256 of file bytes), so one fresh key per upload,
// re-sent unchanged on the 401-refresh retry, makes a retried upload
// replay instead of executing twice.

export function buildQrUploadHeaders(args: {
  token?: string;
  idempotencyKey?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey;
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  return headers;
}
