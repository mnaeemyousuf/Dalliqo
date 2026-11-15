/// Commission maths — the Dart mirror of shared/src/commission.ts (same rules, same tests), so the
/// app shows correct figures for deals edited offline. Amounts are whole rupees.
library;

const dealStages = ['INQUIRY', 'QUALIFIED', 'SITE_VISIT', 'NEGOTIATION', 'OFFER', 'TOKEN', 'AGREEMENT', 'PAYMENT', 'TRANSFER', 'CLOSED_WON', 'CLOSED_LOST'];
const openDealStages = ['INQUIRY', 'QUALIFIED', 'SITE_VISIT', 'NEGOTIATION', 'OFFER', 'TOKEN', 'AGREEMENT', 'PAYMENT', 'TRANSFER'];
const dealChecklistItems = [
  'DOCUMENTS_COLLECTED', 'BUYER_VERIFIED', 'SELLER_VERIFIED', 'TOKEN_RECEIVED', 'AGREEMENT_SIGNED',
  'DUES_CHECKED', 'TRANSFER_DOCS_READY', 'PAYMENT_COMPLETED', 'COMMISSION_RECEIVED', 'DEAL_CLOSED',
];
const paymentMethods = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'JAZZCASH', 'EASYPAISA', 'OTHER'];

class AgentShareSummary {
  const AgentShareSummary({required this.userId, required this.sharePct, required this.expected, required this.received, required this.paidOut, required this.owed});
  final String userId;
  final num sharePct;
  final int expected;
  final int received;
  final int paidOut;
  final int owed;
}

/// An outside dealer, referrer or other branch paid from the commission before the agents.
class ExternalShareSummary {
  const ExternalShareSummary({this.id, required this.kind, required this.name, required this.expected, required this.earned, required this.paid, required this.owed});
  final String? id;
  final String kind;
  final String name;
  final int expected;
  final int earned;
  final int paid;
  final int owed;
}

class CommissionSummary {
  const CommissionSummary({
    required this.basePrice,
    required this.expectedBuyer,
    required this.expectedSeller,
    required this.receivedBuyer,
    required this.receivedSeller,
    required this.agents,
    this.adjustments = 0,
    this.external = const [],
    this.agencyExpected = 0,
    this.agencyReceived = 0,
    this.lifecycle = 'EXPECTED',
  });

  final num basePrice;
  final int expectedBuyer;
  final int expectedSeller;
  final int receivedBuyer;
  final int receivedSeller;
  final List<AgentShareSummary> agents;
  /// Sum of commission adjustments (+ / −) recorded on the deal.
  final int adjustments;
  final List<ExternalShareSummary> external;
  final int agencyExpected;
  final int agencyReceived;

  /// EXPECTED / APPROVED / PARTIALLY_RECEIVED / RECEIVED / DISTRIBUTED / PAID (same rule as the API).
  final String lifecycle;

  int get expected => (expectedBuyer + expectedSeller + adjustments) < 0 ? 0 : expectedBuyer + expectedSeller + adjustments;
  int get received => receivedBuyer + receivedSeller;
  int get outstanding => expected - received > 0 ? expected - received : 0;

  /// PENDING / PARTIALLY_RECEIVED / RECEIVED (same rule as the API).
  String get status => received <= 0 ? 'PENDING' : (received >= expected && expected > 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED');
}

String _id(dynamic v) => v is Map ? '${v['_id']}' : '$v';

/// Expected commission for one side: a percentage of the base price, or a fixed amount.
int sideExpected(Map? term, num basePrice) {
  final value = (term?['value'] as num?) ?? 0;
  if (value <= 0) return 0;
  return term!['mode'] == 'FIXED' ? value.round() : (basePrice * value / 100).round();
}

/// Everything the deal screens show about a deal's commission.
CommissionSummary summarizeCommission(Map<String, dynamic> deal) {
  final base = (deal['finalPrice'] as num?) ?? (deal['agreedPrice'] as num?) ?? 0;
  final commission = deal['commission'] as Map?;
  final buyer = sideExpected(commission?['buyer'] as Map?, base);
  final seller = sideExpected(commission?['seller'] as Map?, base);
  final payments = ((deal['payments'] as List?) ?? const []).whereType<Map>();
  int paid(String side) => payments.where((p) => p['side'] == side).fold(0, (s, p) => s + ((p['amount'] as num?) ?? 0).round());
  final rBuyer = paid('BUYER');
  final rSeller = paid('SELLER');
  final adjustments = ((deal['adjustments'] as List?) ?? const []).whereType<Map>().fold<int>(0, (s, a) => s + ((a['amount'] as num?) ?? 0).round());
  final total = (buyer + seller + adjustments) < 0 ? 0 : buyer + seller + adjustments;
  final received = rBuyer + rSeller;
  // Outside shares come off the top; agents split what the agency keeps.
  final ratio = total > 0 ? (received / total).clamp(0, 1) : 0;
  final external = ((deal['externalShares'] as List?) ?? const []).whereType<Map>().map((x) {
    final value = (x['value'] as num?) ?? 0;
    final expected = x['mode'] == 'FIXED' ? value.round() : (total * value / 100).round();
    final earned = (expected * ratio).round();
    final paid = ((x['paid'] as num?) ?? 0).round();
    return ExternalShareSummary(id: x['_id'] as String?, kind: '${x['kind']}', name: '${x['name'] ?? ''}', expected: expected, earned: earned, paid: paid, owed: earned - paid > 0 ? earned - paid : 0);
  }).toList();
  final extExpected = external.fold(0, (s, x) => s + x.expected);
  final extEarned = external.fold(0, (s, x) => s + x.earned);
  final agencyExpected = total - extExpected > 0 ? total - extExpected : 0;
  final agencyReceived = received - extEarned > 0 ? received - extEarned : 0;
  final payouts = ((deal['payouts'] as List?) ?? const []).whereType<Map>();
  final agents = ((deal['agents'] as List?) ?? const []).whereType<Map>().map((a) {
    final id = _id(a['userId']);
    final pct = (a['sharePct'] as num?) ?? 0;
    final paidOut = payouts.where((p) => _id(p['userId']) == id && p['status'] == 'PAID').fold(0, (s, p) => s + ((p['amount'] as num?) ?? 0).round());
    final share = (agencyReceived * pct / 100).round();
    return AgentShareSummary(userId: id, sharePct: pct, expected: (agencyExpected * pct / 100).round(), received: share, paidOut: paidOut, owed: share - paidOut > 0 ? share - paidOut : 0);
  }).toList();
  final status = received <= 0 ? 'PENDING' : (received >= total && total > 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED');
  final allRecorded = agents.every((a) => payouts.where((p) => _id(p['userId']) == a.userId).fold<num>(0, (s, p) => s + ((p['amount'] as num?) ?? 0)) >= a.received);
  final lifecycle = status == 'PENDING'
      ? (deal['commissionApprovedAt'] != null ? 'APPROVED' : 'EXPECTED')
      : status == 'PARTIALLY_RECEIVED'
          ? 'PARTIALLY_RECEIVED'
          : agents.every((a) => a.owed == 0) && external.every((x) => x.owed == 0)
              ? 'PAID'
              : allRecorded
                  ? 'DISTRIBUTED'
                  : 'RECEIVED';
  return CommissionSummary(
    basePrice: base,
    expectedBuyer: buyer,
    expectedSeller: seller,
    receivedBuyer: rBuyer,
    receivedSeller: rSeller,
    agents: agents,
    adjustments: adjustments,
    external: external,
    agencyExpected: agencyExpected,
    agencyReceived: agencyReceived,
    lifecycle: lifecycle,
  );
}

/// Agent shares must add up to 100% (0.01 tolerance) and each be above zero.
bool sharesValid(List<num> shares) {
  if (shares.isEmpty) return false;
  final sum = shares.fold<num>(0, (s, x) => s + x);
  return (sum - 100).abs() < 0.01 && shares.every((s) => s > 0);
}

/// The business's configurable deal pipeline (Settings → deal pipeline on the web). Stage keys
/// are fixed; a business can switch middle stages off and rename them. Falls back to every stage
/// with the built-in names when it has not been loaded (e.g. offline).
class DealPipeline {
  const DealPipeline({this.disabled = const {}, this.labels = const {}, this.labelsUr = const {}});

  final Set<String> disabled;
  final Map<String, String> labels;
  final Map<String, String> labelsUr;

  static const requiredStages = {'INQUIRY', 'CLOSED_WON', 'CLOSED_LOST'};

  factory DealPipeline.fromJson(Map<String, dynamic> json) {
    final disabled = <String>{};
    final labels = <String, String>{};
    final labelsUr = <String, String>{};
    for (final raw in (json['stages'] as List? ?? const [])) {
      final s = raw as Map<String, dynamic>;
      final stage = s['stage'] as String?;
      if (stage == null) continue;
      if (s['enabled'] == false && !requiredStages.contains(stage)) disabled.add(stage);
      final label = (s['label'] as String? ?? '').trim();
      final labelUr = (s['labelUr'] as String? ?? '').trim();
      if (label.isNotEmpty) labels[stage] = label;
      if (labelUr.isNotEmpty) labelsUr[stage] = labelUr;
    }
    return DealPipeline(disabled: disabled, labels: labels, labelsUr: labelsUr);
  }

  bool enabled(String stage) => !disabled.contains(stage);

  /// Open stages in use, plus [current] if the deal sits in a stage switched off later.
  List<String> openStages({String? current}) => [for (final s in openDealStages) if (enabled(s) || s == current) s];

  /// Custom name for [stage] in the given language, or null to use the built-in translation.
  String? customLabel(String stage, {required bool urdu}) => urdu ? labelsUr[stage] : labels[stage];
}
