import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/data/repositories.dart';

void main() {
  group('PropertyFilter', () {
    final plot = <String, dynamic>{
      'propertyType': 'RESIDENTIAL_PLOT',
      'status': 'AVAILABLE',
      'listingPurpose': 'SALE',
      'area': 'Gulshan-e-Iqbal',
      'society': 'KDA Scheme 24',
      'block': 'Block 13-D',
      'size': 120,
      'sizeUnit': 'SQ_YARD',
      'askingPrice': 15500000,
      'ownerId': {'_id': 'o1', 'fullName': 'Rashid Mehmood'},
    };

    test('matches on text fields case-insensitively', () {
      expect(const PropertyFilter(area: 'gulshan').matches(plot), isTrue);
      expect(const PropertyFilter(society: 'scheme 24', block: '13-d').matches(plot), isTrue);
      expect(const PropertyFilter(area: 'Clifton').matches(plot), isFalse);
    });

    test('compares sizes across units (120 sq yd = 1080 sq ft ≈ 4.8 marla)', () {
      expect(const PropertyFilter(minSize: 1000, maxSize: 1100, sizeUnit: 'SQ_FT').matches(plot), isTrue);
      expect(const PropertyFilter(minSize: 5, sizeUnit: 'MARLA').matches(plot), isFalse);
      expect(const PropertyFilter(maxSize: 5, sizeUnit: 'MARLA').matches(plot), isTrue);
    });

    test('filters by price range and owner (populated or plain id)', () {
      expect(const PropertyFilter(minPrice: 15000000, maxPrice: 16000000, ownerId: 'o1').matches(plot), isTrue);
      expect(const PropertyFilter(ownerId: 'o2').matches(plot), isFalse);
      expect(const PropertyFilter(ownerId: 'o1').matches({...plot, 'ownerId': 'o1'}), isTrue);
      expect(const PropertyFilter(maxPrice: 15000000).matches(plot), isFalse);
    });

    test('copyWith can clear a field and cleared() keeps search and sort', () {
      const f = PropertyFilter(search: 'RE-0001', type: 'HOUSE', sort: 'priceAsc');
      expect(f.copyWith(type: null).type, isNull);
      expect(f.copyWith(status: 'SOLD').type, 'HOUSE');
      final c = f.copyWith(ownerId: 'o1').cleared();
      expect([c.search, c.sort, c.active], ['RE-0001', 'priceAsc', false]);
    });
  });

  group('ClientFilter', () {
    final client = <String, dynamic>{
      'fullName': 'Muhammad Ali',
      'status': 'ACTIVE',
      'purchaseOrRental': 'PURCHASE',
      'categoryId': 'cat1',
      'assignedTo': {'_id': 'u2', 'fullName': 'Ahmed Yousuf'},
      'minBudget': 12000000,
      'maxBudget': 16000000,
      'requirements': [
        {'propertyTypes': ['RESIDENTIAL_PLOT'], 'areas': ['Gulshan-e-Iqbal'], 'societies': <String>[]},
      ],
    };

    test('area matches the requirement areas; property type the requirement types', () {
      expect(const ClientFilter(area: 'gulshan', propertyType: 'RESIDENTIAL_PLOT').matches(client), isTrue);
      expect(const ClientFilter(area: 'DHA').matches(client), isFalse);
      expect(const ClientFilter(propertyType: 'FLAT').matches(client), isFalse);
    });

    test('budget ranges overlap like the API', () {
      expect(const ClientFilter(minBudget: 15000000, maxBudget: 20000000).matches(client), isTrue);
      expect(const ClientFilter(minBudget: 17000000).matches(client), isFalse);
      expect(const ClientFilter(maxBudget: 10000000).matches(client), isFalse);
      expect(const ClientFilter(minBudget: 50000000).matches({...client, 'maxBudget': null}), isTrue);
    });

    test('assigned user and category', () {
      expect(const ClientFilter(assignedTo: 'u2', categoryId: 'cat1').matches(client), isTrue);
      expect(const ClientFilter(assignedTo: 'u1').matches(client), isFalse);
    });
  });
}
