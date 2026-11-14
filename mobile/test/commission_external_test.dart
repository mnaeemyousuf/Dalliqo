import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/commission/commission.dart';

void main() {
  final base = <String, dynamic>{
    'agreedPrice': 20000000,
    'commission': {'buyer': {'mode': 'PERCENT', 'value': 1}, 'seller': {'mode': 'PERCENT', 'value': 1}},
    'agents': [{'userId': 'a', 'sharePct': 100}],
    'externalShares': [{'_id': 'x', 'kind': 'EXTERNAL_DEALER', 'name': 'Khan Estate', 'mode': 'PERCENT', 'value': 25}],
  };

  test('outside shares come off the top, matching the API', () {
    final s = summarizeCommission(base);
    expect(s.agencyExpected, 300000);
    expect(s.external.single.expected, 100000);
    expect(s.lifecycle, 'EXPECTED');
    expect(summarizeCommission({...base, 'commissionApprovedAt': '2026-11-01'}).lifecycle, 'APPROVED');
    final r = summarizeCommission({...base, 'payments': [{'side': 'BUYER', 'amount': 200000}, {'side': 'SELLER', 'amount': 200000}]});
    expect(r.lifecycle, 'RECEIVED');
    expect(r.agents.single.received, 300000);
  });

  test('lifecycle reaches DISTRIBUTED then PAID', () {
    final d = summarizeCommission({...base, 'payments': [{'side': 'BUYER', 'amount': 400000}], 'payouts': [{'userId': 'a', 'amount': 300000, 'status': 'PENDING'}]});
    expect(d.lifecycle, 'DISTRIBUTED');
    final p = summarizeCommission({
      ...base,
      'externalShares': [{'kind': 'EXTERNAL_DEALER', 'name': 'Khan Estate', 'mode': 'PERCENT', 'value': 25, 'paid': 100000}],
      'payments': [{'side': 'BUYER', 'amount': 400000}],
      'payouts': [{'userId': 'a', 'amount': 300000, 'status': 'PAID'}],
    });
    expect(p.lifecycle, 'PAID');
  });
}
