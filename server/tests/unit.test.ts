import { ALL_PERMISSIONS, ROLE_PRESETS, ROLES, matchBand, resolvePermissions } from '@recrm/shared';
import { diffFields } from '../src/utils/diff';
import { normalizePhone } from '../src/utils/phone';

describe('normalizePhone', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['0300-1234567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['00923001234567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['021-34567890', '+922134567890'],
    ['+447911123456', '+447911123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12', 'abc', '+92300', '0300123', '+0123456789'])('rejects %p', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('roles and permissions', () => {
  it('owners hold every permission regardless of what is stored', () => {
    expect(resolvePermissions(ROLES.OWNER, [])).toEqual([...ALL_PERMISSIONS]);
  });

  it('members hold exactly their stored, valid permissions', () => {
    expect(resolvePermissions(ROLES.MEMBER, ['clients:read', 'clients:read', 'bogus'])).toEqual(['clients:read']);
  });

  it('the MEMBER preset cannot administer the business', () => {
    for (const p of ['members:manage', 'business:manage', 'settings:manage', 'audit:read'] as const) {
      expect(ROLE_PRESETS.MEMBER).not.toContain(p);
    }
  });

  it('every preset only uses known permissions', () => {
    for (const preset of Object.values(ROLE_PRESETS)) {
      for (const p of preset) expect(ALL_PERMISSIONS).toContain(p);
    }
  });
});

describe('matchBand', () => {
  it.each([
    [100, 'EXCELLENT'],
    [90, 'EXCELLENT'],
    [89, 'VERY_GOOD'],
    [70, 'GOOD'],
    [60, 'POSSIBLE'],
    [59, 'LOW'],
  ])('%i -> %s', (score, band) => expect(matchBand(score)).toBe(band));
});

describe('diffFields', () => {
  it('reports only changed, listed fields', () => {
    const changes = diffFields({ a: 1, b: 'x', c: [1, 2], d: 5 }, { a: 1, b: 'y', c: [1, 3], e: 9 }, ['a', 'b', 'c', 'e']);
    expect(changes).toEqual([
      { field: 'b', oldValue: 'x', newValue: 'y' },
      { field: 'c', oldValue: [1, 2], newValue: [1, 3] },
      { field: 'e', oldValue: null, newValue: 9 },
    ]);
  });
});
