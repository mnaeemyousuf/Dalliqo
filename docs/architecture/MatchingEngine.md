# Matching engine ✅

Runs only in the backend (`server/src/services/matching/`: `scoring.ts` is pure, `matchingService.ts` persists and notifies). Pure scoring functions are separated
from data access so they can be unit-tested exhaustively.

## Triggers

| Event | Work |
|---|---|
| Property created, or price/size/type/location/purpose/status changed | score that property against all **active requirements** in the business |
| Client requirement created/changed, or client reactivated | score that requirement against all **AVAILABLE** properties |
| Property leaves AVAILABLE (sold/rented/withdrawn) | its matches → `STALE` (kept for history, hidden by default) |
| Settings (weights/thresholds) changed, or `POST /matches/recalculate` | full recompute as a background job |

Triggers subscribe to domain events, so a property save returns immediately; matching runs right
after commit (in-process now, a queue later). Results are idempotent upserts keyed on
`(businessId, requirementId, propertyId)`.

## Candidate generation (MongoDB prefilter)

Hard constraints first, using indexes:

* same `businessId`
* purpose compatible: client PURCHASE ↔ property SALE, RENTAL ↔ RENT (**mismatch = no match**)
* property `status = AVAILABLE`, not deleted; client status ACTIVE, requirement active
* price ≤ `maxBudget × 1.25` (loose, so near-misses can still score)

Everything else is scored, not filtered, so near matches surface with a lower score.

## Weighted scoring (defaults; per-business configurable in `settings`)

| Criterion | Weight | Full marks | Partial | Zero |
|---|---|---|---|---|
| Property type | 25 | type ∈ requirement types | related type (FLAT↔APARTMENT, HOUSE↔PORTION, SHOP↔OFFICE↔COMMERCIAL): 60% | otherwise |
| Area / society | 25 | society matches (and block, if requested) | society matches, different block: 80% · area matches only: 60% | neither |
| Budget | 25 | asking price within [min, max] | over max by ≤5%: 70% · ≤10%: 45% · ≤20%: 20% · negotiable with `minimumPrice` ≤ max: at least 80% · below min: 85% | over by >20% |
| Size | 15 | `sizeSqft` within range | within 10% outside: 65% · within 20%: 30% | further |
| Purpose | 10 | compatible (always, after the prefilter) | — | — |

**Unspecified preference** (e.g. no area given) scores **50%** of that weight: flexible clients
still match, but never outrank clients whose stated preferences are met. Text comparisons use
normalised forms (case, punctuation, common spellings: "Gulshan-e-Iqbal" = "gulshan e iqbal").
Sizes compare in square feet using the business's unit table (sq yd = 9 sq ft, marla = 225 sq ft
by default, kanal = 20 marla).

```text
matchScore = round( Σ weight_i × fraction_i )        // 0–100
```

Output:
```json
{ "matchScore": 95, "band": "EXCELLENT",
  "breakdown": { "type": 25, "location": 25, "budget": 25, "size": 10, "purpose": 10 },
  "matchReasons": ["Property type matches", "Society matches (Gulshan-e-Iqbal)", "Within budget", "Size slightly outside range", "Purpose matches"] }
```
Reasons are stored as **codes + params** (`{code:'BUDGET_WITHIN'}`) and rendered by the client in
English or Urdu, rather than stored as English sentences.

## Thresholds

| Score | Band |
|---|---|
| 90–100 | Excellent |
| 80–89 | Very good |
| 70–79 | Good |
| 60–69 | Possible |
| < 60 | Low (not stored) |

Settings: `storeThreshold` (default 60), `notifyThreshold` (default 80). A match ≥ notify threshold
that has not been notified yields a `match.created` socket event, an in-app notification and an FCM
push to the client's `assignedTo` user (or all members if unassigned); `notified=true` prevents repeats
when scores are recomputed.

## Testing

* Table-driven unit tests per criterion (boundaries: exactly max budget, 5%/10%/20% over, unit conversions).
* Property-based test: the score is always 0–100, and adding a satisfied preference never lowers it.
* Integration: create property → matches appear for the right clients only, in the same business only.
