import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:real_estate_crm/features/more/extras.dart';

void main() {
  group('lead filters on the client list', () {
    final hotWeb = {'fullName': 'A', 'source': 'WEBSITE', 'temperature': 'HOT', 'assignedTo': null};
    final coldWalkIn = {'fullName': 'B', 'source': 'WALK_IN', 'temperature': 'COLD', 'assignedTo': {'_id': 'u1'}};

    test('source, temperature and unassigned narrow the list', () {
      expect(const ClientFilter(source: 'WEBSITE').matches(hotWeb), isTrue);
      expect(const ClientFilter(source: 'WEBSITE').matches(coldWalkIn), isFalse);
      expect(const ClientFilter(temperature: 'COLD').matches(coldWalkIn), isTrue);
      expect(const ClientFilter(temperature: 'COLD').matches(hotWeb), isFalse);
      expect(const ClientFilter(unassigned: true).matches(hotWeb), isTrue);
      expect(const ClientFilter(unassigned: true).matches(coldWalkIn), isFalse);
      expect(const ClientFilter().matches(coldWalkIn), isTrue);
    });

    test('they count as active filters and are cleared together', () {
      const f = ClientFilter(search: 'ali', temperature: 'HOT', unassigned: true);
      expect(f.active, isTrue);
      expect(f.cleared().active, isFalse);
      expect(f.cleared().search, 'ali');
      expect(f.copyWith(temperature: null).temperature, isNull);
      expect(f == f.copyWith(), isTrue);
      expect(f == f.copyWith(unassigned: false), isFalse);
    });
  });

  group('saved views use the web parameter names', () {
    test('client filters round-trip', () {
      const f = ClientFilter(search: 'khan', status: 'ACTIVE', purpose: 'PURCHASE', source: 'FACEBOOK', temperature: 'HOT', unassigned: true, area: 'DHA', minBudget: 5000000, maxSize: 500, sizeUnit: 'SQ_YARD');
      final p = clientViewParams(f);
      expect(p, {'q': 'khan', 'status': 'ACTIVE', 'purpose': 'PURCHASE', 'source': 'FACEBOOK', 'temperature': 'HOT', 'unassigned': 'true', 'area': 'DHA', 'minBudget': '5000000', 'maxSize': '500', 'sizeUnit': 'SQ_YARD'});
      expect(clientFilterFromView(p), f);
    });

    test('a view saved on the web opens on the phone, ignoring what the phone has no filter for', () {
      final f = clientFilterFromView({'temperature': 'WARM', 'sort': '-updatedAt', 'view': 'table', 'page': '3', 'minBudget': ''});
      expect(f.temperature, 'WARM');
      expect(f.minBudget, isNull);
      expect(f.sort, 'updated');
    });

    test('property filters round-trip', () {
      const f = PropertyFilter(type: 'HOUSE', purpose: 'SALE', society: 'Gulshan', minPrice: 10000000, needsVerification: true);
      final p = propertyViewParams(f);
      expect(p, {'propertyType': 'HOUSE', 'listingPurpose': 'SALE', 'society': 'Gulshan', 'minPrice': '10000000', 'verification': 'stale'});
      final back = propertyFilterFromView(p);
      expect(back.type, 'HOUSE');
      expect(back.purpose, 'SALE');
      expect(back.society, 'Gulshan');
      expect(back.minPrice, 10000000);
      expect(back.needsVerification, isTrue);
    });
  });
}
