# RENEWAL DESK — PRODUCTION RELEASE CHECKLIST

## Release Verification Checklist

- [x] **Repository Cleanliness**: Working tree clean, zero merge conflicts, zero committed secrets.
- [x] **Backend Automated Tests**: 133/133 pytest tests passing.
- [x] **Mobile Automated Tests**: 10/10 TypeScript runtime/health tests passing.
- [x] **Typecheck & Lint**: Zero errors on `tsc --noEmit` and `expo lint`.
- [x] **Multi-Tenant Security**: Tenant isolation verified for all mobile endpoints.
- [x] **Secure Session Storage**: JWT tokens stored exclusively in Android Keystore via SecureStore.
- [x] **Push Notifications**: Android 13+ permissions, 4 urgency channels, allow-listed payload routing.
- [x] **Internationalization**: Dynamic currency symbol, ISO formatting, authoritative backend timezone.
- [x] **Duplicate Action Protection**: In-flight debounce and Idempotency keys on all financial mutations.
- [x] **Build & Versioning**: Version `1.0.0`, VersionCode `5`, EAS production bundle configured.
- [x] **No Mock/Debug Leaks**: Console logs for tokens and payloads removed from production paths.
- [x] **External Blockers Documented**: Google Play Closed Testing enrollment & Meta Business Verification.
