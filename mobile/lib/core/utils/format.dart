import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

/// Pakistani numbering: 15,500,000 → "PKR 1.55 Crore", 550,000 → "PKR 5.5 Lakh".
String formatPkr(num? amount, {bool urdu = false, bool currency = true}) {
  if (amount == null) return '—';
  final prefix = currency ? (urdu ? 'روپے ' : 'PKR ') : '';
  String trim(double v) => v.toStringAsFixed(2).replaceAll(RegExp(r'\.?0+$'), '');
  if (amount >= 10000000) return '$prefix${trim(amount / 10000000)} ${urdu ? 'کروڑ' : 'Crore'}';
  if (amount >= 100000) return '$prefix${trim(amount / 100000)} ${urdu ? 'لاکھ' : 'Lakh'}';
  return '$prefix${NumberFormat.decimalPattern('en').format(amount)}';
}

/// "PKR 1.2 – 1.6 Crore" when both ends share a unit.
String formatRange(num? min, num? max, {bool urdu = false}) {
  if (min == null && max == null) return '—';
  if (min != null && max != null) {
    int unit(num n) => n >= 10000000 ? 10000000 : (n >= 100000 ? 100000 : 1);
    final u = unit(max);
    if (u > 1 && unit(min) == u) {
      final head = (min / u).toStringAsFixed(2).replaceAll(RegExp(r'\.?0+$'), '');
      return formatPkr(max, urdu: urdu).replaceFirstMapped(RegExp(r'[\d.]+'), (m) => '$head – ${m[0]}');
    }
    return '${formatPkr(min, urdu: urdu)} – ${formatPkr(max, urdu: urdu)}';
  }
  return min != null ? '≥ ${formatPkr(min, urdu: urdu)}' : '≤ ${formatPkr(max, urdu: urdu)}';
}

String formatDate(DateTime? d, {bool time = false, String locale = 'en'}) {
  if (d == null) return '—';
  final l = locale == 'ur' ? 'ur' : 'en';
  return (time ? DateFormat.yMMMd(l).add_jm() : DateFormat.yMMMd(l)).format(d.toLocal());
}

String formatTime(DateTime? d, {String locale = 'en'}) =>
    d == null ? '—' : DateFormat.jm(locale == 'ur' ? 'ur' : 'en').format(d.toLocal());

String relativeTime(DateTime d, {String locale = 'en'}) {
  final diff = DateTime.now().difference(d);
  final ur = locale == 'ur';
  if (diff.inMinutes < 1) return ur ? 'ابھی' : 'just now';
  if (diff.inHours < 1) return ur ? '${diff.inMinutes} منٹ پہلے' : '${diff.inMinutes} min ago';
  if (diff.inDays < 1) return ur ? '${diff.inHours} گھنٹے پہلے' : '${diff.inHours} h ago';
  if (diff.inDays < 30) return ur ? '${diff.inDays} دن پہلے' : '${diff.inDays} d ago';
  return formatDate(d, locale: locale);
}

DateTime? parseDate(dynamic v) => v is String ? DateTime.tryParse(v) : (v is DateTime ? v : null);

/// Normalises Pakistani numbers to E.164 (+923001234567); returns null if invalid.
String? normalizePhone(String input) {
  var d = input.replaceAll(RegExp(r'[\s\-().]'), '');
  if (d.isEmpty) return null;
  if (d.startsWith('00')) d = '+${d.substring(2)}';
  if (!d.startsWith('+')) {
    if (RegExp(r'^03\d{9}$').hasMatch(d)) return '+92${d.substring(1)}';
    if (RegExp(r'^3\d{9}$').hasMatch(d)) return '+92$d';
    if (RegExp(r'^92\d{10}$').hasMatch(d)) return '+$d';
    if (RegExp(r'^0[1-9]\d{8,9}$').hasMatch(d)) return '+92${d.substring(1)}';
    return null;
  }
  if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(d)) return null;
  return d;
}

String digitsOnly(String? s) => (s ?? '').replaceAll(RegExp(r'\D'), '');

/// One-tap communication deep links.
class Contact {
  static Future<bool> call(String phone) => launchUrl(Uri(scheme: 'tel', path: phone));
  static Future<bool> sms(String phone) => launchUrl(Uri(scheme: 'sms', path: phone));
  static Future<bool> email(String email) => launchUrl(Uri(scheme: 'mailto', path: email));
  static Future<bool> whatsapp(String phone, {String? text}) => launchUrl(
        Uri.parse('https://wa.me/${digitsOnly(phone)}${text != null ? '?text=${Uri.encodeComponent(text)}' : ''}'),
        mode: LaunchMode.externalApplication,
      );
  static Future<bool> openMaps(double lat, double lng) => launchUrl(
        Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng'),
        mode: LaunchMode.externalApplication,
      );
  static Future<bool> openUrl(String url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}
