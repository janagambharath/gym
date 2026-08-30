export type ApiErrorDetails = {
  code?: string;
  message?: string;
  status?: number;
};

const CODE_MESSAGES: Record<string, string> = {
  ACCOUNT_DISABLED: 'This account is disabled. Contact your administrator.',
  AUTH_ERROR: 'Your session is no longer valid. Please sign in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  GYM_INACTIVE: 'This gym account is not active. Contact Renewal Desk support.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  MEMBER_LIMIT: 'Your member limit has been reached. Update your subscription to add more members.',
  NOT_FOUND: 'The requested record is no longer available.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  SUBSCRIPTION_EXPIRED: 'Your subscription has expired. Contact Renewal Desk support to restore access.',
  SUBSCRIPTION_PENDING: 'Your subscription is still being activated. Please try again shortly.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  UNAUTHORIZED: 'Your session is no longer valid. Please sign in again.',
  WHATSAPP_FAILED: 'WhatsApp could not complete this request. Check its connection and try again.',
  WHATSAPP_NOT_CONNECTED: 'WhatsApp is not connected for this gym.',
};

function isSafeValidationMessage(value: string | undefined): value is string {
  return !!value && value.length <= 240 && !/[\r\n\t{}\[\]]/.test(value);
}

/**
 * Keeps operational error feedback useful without exposing raw backend or
 * infrastructure failures to gym owners.
 */
export function getUserFacingApiError({ code, message, status }: ApiErrorDetails): string {
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  if ((code === 'VALIDATION_ERROR' || code === 'BAD_REQUEST') && isSafeValidationMessage(message)) {
    return message;
  }

  if (status === 401) return 'Your session is no longer valid. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested record is no longer available.';
  if (status === 409) return 'This action conflicts with a recent change. Refresh and try again.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status && status >= 500) return 'The server could not complete this request. Please try again.';

  return 'Something went wrong. Please try again.';
}
