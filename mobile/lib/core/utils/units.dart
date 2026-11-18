/// Square feet per unit, used to compare sizes across units offline. Starts with the API's
/// defaults; marla, kanal and acre then follow the business's own setting
/// (Administration → Business settings → square feet per marla), which arrives with sync.
final Map<String, double> sqftPerUnit = {'SQ_FT': 1.0, 'SQ_YARD': 9.0, 'SQ_METER': 10.7639, 'MARLA': 225.0, 'KANAL': 4500.0, 'ACRE': 43560.0};

/// Applies the business's `sqftPerUnit` from its settings (sync bootstrap or the settings screen).
void applyUnitSettings(Map<String, dynamic>? settings) {
  final m = settings?['sqftPerUnit'];
  if (m is! Map) return;
  for (final k in const ['MARLA', 'KANAL', 'ACRE']) {
    final v = m[k];
    if (v is num && v > 0) sqftPerUnit[k] = v.toDouble();
  }
}
