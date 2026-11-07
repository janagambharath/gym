// Load gate for settings screens (V9-M8 EditGymProfile, V9-M9 PaymentSetup).
//
// The silent-wipe class: a settings GET failure used to render the form
// with blank defaults, and Save then overwrote the stored values with
// nulls (email/phone/address, UPI ID) and forced defaults (timezone,
// is_active). The form must not exist — editable or submittable — until
// the GET has succeeded. This pure resolver is the single decision point
// both screens share, so the gate cannot drift apart again.

export type SettingsLoadState = {
  /** The GET is still in flight (initial load or retry). */
  loading: boolean;
  /** The GET has succeeded at least once and the form holds real values. */
  loaded: boolean;
  /** Message from the failed GET, when one happened. */
  loadError?: string;
};

export type SettingsLoadView = 'loading' | 'error' | 'form';

/** Which view a settings screen shows for a given load state. */
export function resolveSettingsLoadView(state: SettingsLoadState): SettingsLoadView {
  if (state.loaded) return 'form';
  // A retry in flight wins over the stale error from the previous
  // attempt — the screens clear loadError at retry start, but the
  // resolver must not show "error" for a load that is running.
  if (state.loading) return 'loading';
  if (state.loadError) return 'error';
  return 'loading';
}
