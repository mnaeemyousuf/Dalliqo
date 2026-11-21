import { z } from 'zod';

/**
 * Plain-English field messages. The web and the phone show these next to the field, so Zod 4's
 * built-in wording ("Too small: expected string to have >=2 characters") is replaced here.
 * A message written on a schema (`{ message: … }`) still wins over these.
 */
const sizeOf = (origin: unknown, n: unknown) =>
  origin === 'string' ? `${n} character${n === 1 ? '' : 's'}` : origin === 'array' || origin === 'set' ? `${n} item${n === 1 ? '' : 's'}` : String(n);

export function friendlyMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'Required' : `Expected ${issue.expected}`;
    case 'too_small':
      return issue.origin === 'string' && issue.minimum === 1 ? 'Required' : `Must be at least ${sizeOf(issue.origin, issue.minimum)}`;
    case 'too_big':
      return `Must be at most ${sizeOf(issue.origin, issue.maximum)}`;
    case 'invalid_format':
      if (issue.format === 'email') return 'Invalid email address';
      if (issue.format === 'url') return 'Invalid link';
      if (issue.format === 'guid' || issue.format === 'uuid') return 'Invalid id';
      return 'Invalid format';
    case 'invalid_value':
      return 'Choose one of the allowed values';
    case 'unrecognized_keys':
      return `Unknown field${issue.keys.length === 1 ? '' : 's'}: ${issue.keys.join(', ')}`;
    case 'invalid_union':
      return 'Invalid value';
    default:
      return undefined;
  }
}

z.config({ customError: friendlyMessage });
