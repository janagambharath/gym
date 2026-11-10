// Campaign create body builder (V12-D2).
//
// Pure module, free of react-native / expo imports on purpose: the
// screen cannot be imported under node, so the body rule lives here
// where the `tsx --test` harness can exercise it directly.
//
// The bug: CampaignCreateScreen POSTed `template_name`, which the
// backend silently ignores — create reads only `segment_type` /
// `message_template` / `whatsapp_template_name`
// (app/mobile_api/campaigns.py). The campaign was stored with
// whatsapp_template_name=None, so at send time the owner-picked
// template never went out: members got the generic plain-text
// reminder while the UI reported "Campaign Launched!". The PWA
// already sends the right keys (campaign-create.js, V11-C1 comment):
// the chosen template id IS the Meta template name, so it is the
// whatsapp_template_name; the template body (or the typed message,
// which Android has no input for) is the message_template the send
// path uses for offer / announcement text
// (campaign_service.py: gym_special_offer_01 reads
// campaign.message_template as the offer description).
import type { CampaignSegmentType, CampaignTemplate, CampaignType, PromoPreset } from '../types';

export type CampaignCreateBodyInput = {
  name: string;
  campaignType: CampaignType;
  promoPreset: PromoPreset;
  /** Human label of the selected promo preset, e.g. "Special Offer". */
  promoPresetDesc: string;
  template: CampaignTemplate | null;
  segmentType: CampaignSegmentType;
  importedContacts?: { name: string; phone: string }[];
  excludeRecent: boolean;
};

/**
 * Build the POST /api/mobile/v1/campaigns body with the keys the
 * backend actually reads. `template_name` is deliberately NOT sent —
 * the backend drops it. message_template is the template body
 * preview; for a promotion with no body preview it falls back to the
 * preset description, so the offer text still reaches the send path.
 */
export function buildCampaignCreateBody(
  input: CampaignCreateBodyInput,
): Record<string, unknown> {
  const messageTemplate =
    input.template?.body_preview ||
    (input.campaignType === 'promotion' ? input.promoPresetDesc : undefined) ||
    undefined;
  return {
    name: input.name,
    campaign_type: input.campaignType,
    promo_preset: input.campaignType === 'promotion' ? input.promoPreset : undefined,
    whatsapp_template_name: input.template?.name,
    message_template: messageTemplate,
    segment_type: input.segmentType,
    imported_contacts:
      input.importedContacts && input.importedContacts.length > 0
        ? input.importedContacts
        : undefined,
    exclude_recent: input.excludeRecent,
  };
}
