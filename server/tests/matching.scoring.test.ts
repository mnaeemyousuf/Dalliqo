import { DEFAULT_MATCHING_SETTINGS } from '@recrm/shared';
import {
  placeMatches,
  purposeCompatible,
  scoreBudget,
  scoreLocation,
  scoreMatch,
  scoreSize,
  scoreType,
  type ScoringProperty,
  type ScoringRequirement,
} from '../src/services/matching/scoring';

const W = DEFAULT_MATCHING_SETTINGS.weights;

// 120 sq yd = 1080 sq ft
const plot: ScoringProperty = {
  propertyType: 'RESIDENTIAL_PLOT',
  listingPurpose: 'SALE',
  society: 'Gulshan-e-Iqbal',
  area: 'Gulshan',
  block: '13-D',
  sizeSqft: 1080,
  askingPrice: 15_500_000,
  negotiable: true,
};

const buyer: ScoringRequirement = {
  purpose: 'PURCHASE',
  propertyTypes: ['RESIDENTIAL_PLOT'],
  areas: [],
  societies: ['gulshan e iqbal'],
  blocks: [],
  minSizeSqft: 900,
  maxSizeSqft: 1200,
  minBudget: 12_000_000,
  maxBudget: 16_000_000,
};

describe('matching scoring', () => {
  it('gives 100 for a perfect match with the spec example reasons', () => {
    const r = scoreMatch(buyer, plot, W)!;
    expect(r.matchScore).toBe(100);
    expect(r.band).toBe('EXCELLENT');
    expect(r.matchReasons.map((x) => x.code)).toEqual(['TYPE_MATCH', 'SOCIETY_MATCH', 'BUDGET_WITHIN', 'SIZE_WITHIN', 'PURPOSE_MATCH']);
    expect(r.breakdown).toEqual({ type: 25, location: 25, budget: 25, size: 15, purpose: 10 });
  });

  it('treats a purpose mismatch as disqualifying', () => {
    expect(scoreMatch({ ...buyer, purpose: 'RENTAL' }, plot, W)).toBeNull();
    expect(purposeCompatible('PURCHASE', 'SALE')).toBe(true);
    expect(purposeCompatible('RENTAL', 'RENT')).toBe(true);
    expect(purposeCompatible('PURCHASE', 'RENT')).toBe(false);
  });

  it('normalises place names', () => {
    expect(placeMatches('Gulshan-e-Iqbal', 'gulshan e iqbal')).toBe(true);
    expect(placeMatches('DHA', 'DHA Karachi')).toBe(true);
    expect(placeMatches('Clifton', 'PECHS')).toBe(false);
    expect(placeMatches('', 'PECHS')).toBe(false);
  });

  describe('type', () => {
    it.each([
      [['RESIDENTIAL_PLOT'], 1],
      [['HOUSE'], 0],
      [[], 0.5],
    ])('%j -> %d', (types, fraction) => {
      expect(scoreType({ ...buyer, propertyTypes: types as never }, plot).fraction).toBe(fraction);
    });
    it('related types score 60%', () => {
      expect(scoreType({ ...buyer, propertyTypes: ['FLAT'] }, { ...plot, propertyType: 'APARTMENT' }).fraction).toBe(0.6);
    });
  });

  describe('location', () => {
    it('society match in another block scores 80%', () => {
      expect(scoreLocation({ ...buyer, blocks: ['10'] }, plot).fraction).toBe(0.8);
      expect(scoreLocation({ ...buyer, blocks: ['13-d'] }, plot).fraction).toBe(1);
    });
    it('area-only match scores 60%', () => {
      expect(scoreLocation({ ...buyer, societies: [], areas: ['Gulshan'] }, { ...plot, society: 'Rufi Lake Drive' }).fraction).toBe(0.6);
    });
    it('no preference is neutral, a wrong place is zero', () => {
      expect(scoreLocation({ ...buyer, societies: [] }, plot).fraction).toBe(0.5);
      expect(scoreLocation({ ...buyer, societies: ['Clifton'] }, plot).fraction).toBe(0);
    });
  });

  describe('budget', () => {
    const r = (askingPrice: number, extra: Partial<ScoringProperty> = {}) => scoreBudget(buyer, { ...plot, negotiable: false, askingPrice, ...extra });
    it.each([
      [16_000_000, 1], // exactly at max
      [16_800_000, 0.7], // 5% over
      [17_600_000, 0.45], // 10% over
      [19_200_000, 0.2], // 20% over
      [19_300_000, 0], // >20% over
      [11_000_000, 0.85], // below min
    ])('%d -> %d', (price, fraction) => expect(r(price).fraction).toBe(fraction));

    it('negotiable listings whose minimum price fits score at least 80%', () => {
      expect(r(19_000_000, { negotiable: true, minimumPrice: 15_900_000 }).fraction).toBe(0.8);
      expect(r(19_000_000, { negotiable: true, minimumPrice: 16_500_000 }).fraction).toBe(0.2);
    });
    it('no budget is neutral', () => {
      expect(scoreBudget({ ...buyer, minBudget: undefined, maxBudget: undefined }, plot).fraction).toBe(0.5);
    });
  });

  describe('size', () => {
    const r = (sizeSqft: number) => scoreSize(buyer, { ...plot, sizeSqft }).fraction;
    it.each([
      [1200, 1],
      [1320, 0.65], // 10% over max
      [1440, 0.3], // 20% over max
      [1500, 0],
      [810, 0.65], // 10% under min
    ])('%d sq ft -> %d', (s, f) => expect(r(s)).toBe(f));
  });

  it('respects custom weights and stays within 0–100', () => {
    const weights = { type: 40, location: 30, budget: 20, size: 5, purpose: 5 };
    const r = scoreMatch({ ...buyer, societies: ['Clifton'] }, plot, weights)!;
    expect(r.matchScore).toBe(70);
    for (let price = 5_000_000; price < 30_000_000; price += 1_000_000) {
      const s = scoreMatch(buyer, { ...plot, askingPrice: price }, W)!.matchScore;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('adding a satisfied preference never lowers the score', () => {
    const vague = scoreMatch({ ...buyer, societies: [], propertyTypes: [] }, plot, W)!.matchScore;
    const precise = scoreMatch(buyer, plot, W)!.matchScore;
    expect(precise).toBeGreaterThanOrEqual(vague);
  });
});
