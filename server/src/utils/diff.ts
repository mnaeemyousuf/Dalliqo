export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function normalise(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'toHexString' in v && typeof (v as { toHexString: unknown }).toHexString === 'function') {
    return (v as { toHexString(): string }).toHexString();
  }
  if (Array.isArray(v)) return v.map(normalise);
  return v;
}

/** Field-level diff for audit logs. Only the listed fields are compared. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (!(field in after)) continue;
    const oldValue = normalise(before[field]);
    const newValue = normalise(after[field]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}
