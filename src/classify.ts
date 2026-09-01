import type { ColumnInfo, DatasetInfo } from './db';

/**
 * Sensitivity tiers. These decide what an agent is even able to ask for.
 *
 *  identifier - points at one human. Never leaves this page in any form.
 *  sensitive  - a personal measurement (pay, balance, score). Aggregates only.
 *  quasi      - a grouping dimension that could re-identify someone in a small
 *               cell (department, region, job title). Groupable, but every group
 *               it produces must clear the k-anonymity threshold.
 *  safe       - everything else.
 */
export type Tier = 'identifier' | 'sensitive' | 'quasi' | 'safe';

export interface ClassifiedColumn extends ColumnInfo {
  tier: Tier;
  reason: string;
  overridden: boolean;
}

const IDENTIFIER_PATTERN =
  /(^|_|\b)(name|firstname|lastname|surname|fullname|email|mail|phone|tel|mobile|ssn|sin|nric|passport|address|street|postcode|zip|uuid|guid|username|user_?id|employee_?id|customer_?id|account(_?no|_?number)?|iban|card)($|_|\b)/i;

const SENSITIVE_PATTERN =
  /(^|_|\b)(salary|salaries|pay|payrate|wage|comp|compensation|bonus|income|earnings|revenue_?per|balance|amount|credit|debt|loan|score|rating|price|cost|premium|claim|diagnosis|condition|medication)($|_|\b)/i;

const ID_SUFFIX = /(^id$|_id$|^id_)/i;

export function classifyColumn(col: ColumnInfo, rowCount: number): ClassifiedColumn {
  const base = { ...col, overridden: false };
  const uniqueness = rowCount > 0 ? col.distinctCount / rowCount : 0;

  if (IDENTIFIER_PATTERN.test(col.name) || ID_SUFFIX.test(col.name)) {
    return { ...base, tier: 'identifier', reason: 'column name matches a direct identifier' };
  }
  if (col.type === 'string' && uniqueness > 0.8 && col.distinctCount > 20) {
    return {
      ...base,
      tier: 'identifier',
      reason: `${Math.round(uniqueness * 100)}% of values are unique - behaves like a key`,
    };
  }
  if (SENSITIVE_PATTERN.test(col.name)) {
    return { ...base, tier: 'sensitive', reason: 'column name matches a personal measurement' };
  }
  if (col.type === 'number' && uniqueness > 0.5 && col.distinctCount > 50) {
    return {
      ...base,
      tier: 'sensitive',
      reason: 'high-cardinality numeric - a single value could single someone out',
    };
  }
  if (col.distinctCount > 0 && col.distinctCount <= 50) {
    return { ...base, tier: 'quasi', reason: `${col.distinctCount} distinct values - usable as a grouping key` };
  }
  return { ...base, tier: 'safe', reason: 'low re-identification risk' };
}

export function classifyDataset(info: DatasetInfo): ClassifiedColumn[] {
  return info.columns.map((c) => classifyColumn(c, info.rowCount));
}
