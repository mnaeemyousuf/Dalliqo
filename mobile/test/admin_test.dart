import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/features/settings/admin_screens.dart';

void main() {
  test('a permission list is recognised as a template only on an exact match', () {
    final templates = {
      'AGENT': ['clients:read', 'clients:create', 'deals:read'],
      'VIEWER': ['clients:read'],
    };
    expect(templateOf(['deals:read', 'clients:create', 'clients:read'], templates), 'AGENT');
    expect(templateOf(['clients:read'], templates), 'VIEWER');
    expect(templateOf(['clients:read', 'deals:read'], templates), isNull);
    expect(templateOf([], templates), isNull);
  });
}
