/**
 * Configurable automation rules. The API evaluates them on a schedule and notifies the right
 * people; each business can switch rules on or off and tune the thresholds.
 */

export const AUTOMATION_RULE_KEYS = [
  'HOT_LEAD_UNCONTACTED',
  'LEAD_INACTIVE',
  'PROPERTY_REVERIFY',
  'LISTING_EXPIRY',
  'DEAL_STUCK_NEGOTIATION',
  'AGREEMENT_EXPIRING',
  'VERIFICATION_DUE',
  'RENT_DUE',
  'RENT_OVERDUE',
] as const;
export type AutomationRuleKey = (typeof AUTOMATION_RULE_KEYS)[number];

export interface AutomationRuleDefinition {
  key: AutomationRuleKey;
  unit: 'minutes' | 'days';
  defaultThreshold: number;
  min: number;
  max: number;
  /** Who is notified: the record's assignee / agents, and/or managers (members who can see everything). */
  notify: ('assignee' | 'managers')[];
}

export const AUTOMATION_RULES: Record<AutomationRuleKey, AutomationRuleDefinition> = {
  HOT_LEAD_UNCONTACTED: { key: 'HOT_LEAD_UNCONTACTED', unit: 'minutes', defaultThreshold: 30, min: 5, max: 1440, notify: ['assignee', 'managers'] },
  LEAD_INACTIVE: { key: 'LEAD_INACTIVE', unit: 'days', defaultThreshold: 7, min: 1, max: 90, notify: ['assignee'] },
  PROPERTY_REVERIFY: { key: 'PROPERTY_REVERIFY', unit: 'days', defaultThreshold: 30, min: 7, max: 180, notify: ['assignee'] },
  LISTING_EXPIRY: { key: 'LISTING_EXPIRY', unit: 'days', defaultThreshold: 0, min: 0, max: 30, notify: ['assignee'] },
  DEAL_STUCK_NEGOTIATION: { key: 'DEAL_STUCK_NEGOTIATION', unit: 'days', defaultThreshold: 14, min: 1, max: 120, notify: ['assignee', 'managers'] },
  AGREEMENT_EXPIRING: { key: 'AGREEMENT_EXPIRING', unit: 'days', defaultThreshold: 30, min: 1, max: 120, notify: ['assignee', 'managers'] },
  VERIFICATION_DUE: { key: 'VERIFICATION_DUE', unit: 'days', defaultThreshold: 7, min: 0, max: 60, notify: ['assignee'] },
  RENT_DUE: { key: 'RENT_DUE', unit: 'days', defaultThreshold: 3, min: 0, max: 15, notify: ['assignee'] },
  RENT_OVERDUE: { key: 'RENT_OVERDUE', unit: 'days', defaultThreshold: 1, min: 0, max: 30, notify: ['assignee', 'managers'] },
};

export interface AutomationRuleSetting {
  enabled: boolean;
  threshold: number;
}

export type AutomationSettings = Record<AutomationRuleKey, AutomationRuleSetting>;

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = Object.fromEntries(
  Object.values(AUTOMATION_RULES).map((r) => [r.key, { enabled: true, threshold: r.defaultThreshold }]),
) as AutomationSettings;
