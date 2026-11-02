/// Commission maths — the Dart mirror of shared/src/commission.ts (same rules, same tests), so the
/// app shows correct figures for deals edited offline. Amounts are whole rupees.
library;

const dealStages = ['INQUIRY', 'SITE_VISIT', 'OFFER', 'TOKEN', 'AGREEMENT', 'TRANSFER', 'CLOSED_WON', 'CLOSED_LOST'];
const openDealStages = ['INQUIRY', 'SITE_VISIT', 'OFFER', 'TOKEN', 'AGREEMENT', 'TRANSFER'];
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

class CommissionSummary {
  const CommissionSummary({
    required this.basePrice,
    required this.expectedBuyer,
    required this.expectedSeller,
    required this.receivedBuyer,
    required this.receivedSeller,
    required this.agents,
  });

  final num basePrice;
  final int expectedBuyer;
  final int expectedSeller;
  final int receivedBuyer;
  final int receivedSeller;
  final List<AgentShareSummary> agents;

  int get expected => expectedBuyer + expectedSeller;
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
  final total = buyer + seller;
  final received = rBuyer + rSeller;
  final payouts = ((deal['payouts'] as List?) ?? const []).whereType<Map>();
  final agents = ((deal['agents'] as List?) ?? const []).whereType<Map>().map((a) {
    final id = _id(a['userId']);
    final pct = (a['sharePct'] as num?) ?? 0;
    final paidOut = payouts.where((p) => _id(p['userId']) == id && p['status'] == 'PAID').fold(0, (s, p) => s + ((p['amount'] as num?) ?? 0).round());
    final share = (received * pct / 100).round();
    return AgentShareSummary(userId: id, sharePct: pct, expected: (total * pct / 100).round(), received: share, paidOut: paidOut, owed: share - paidOut > 0 ? share - paidOut : 0);
  }).toList();
  return CommissionSummary(basePrice: base, expectedBuyer: buyer, expectedSeller: seller, receivedBuyer: rBuyer, receivedSeller: rSeller, agents: agents);
}

/// Agent shares must add up to 100% (0.01 tolerance) and each be above zero.
bool sharesValid(List<num> shares) {
  if (shares.isEmpty) return false;
  final sum = shares.fold<num>(0, (s, x) => s + x);
  return (sum - 100).abs() < 0.01 && shares.every((s) => s > 0);
}
