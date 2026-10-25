import '../database/app_database.dart';
import '../utils/format.dart';

/// Thin typed views over API/local JSON. Keeping the JSON as the source means
/// new server fields survive a round trip through an older app version.
abstract class JsonModel {
  JsonModel(this.json, {this.local});

  final Map<String, dynamic> json;

  /// Set when the model comes from the local database.
  final LocalRecord? local;

  /// Id to use in routes and references (server id once synced, device uuid before).
  String get id => local?.refId ?? (json['_id'] as String?) ?? (json['uuid'] as String? ?? '');
  String? get serverId => local?.serverId ?? json['_id'] as String?;
  int get version => local?.version ?? (json['version'] as num?)?.toInt() ?? 0;
  SyncStatus get syncStatus => local?.syncStatus ?? SyncStatus.synced;
  DateTime? get createdAt => parseDate(json['createdAt']);
  DateTime? get updatedAt => parseDate(json['updatedAt']);

  String s(String k) => (json[k] as String?) ?? '';
  String? os(String k) => json[k] as String?;
  num? n(String k) => json[k] as num?;
  List<String> strings(String k) => ((json[k] as List?) ?? const []).cast<String>();

  /// Reference fields may be a plain id or a populated object.
  static String? refId(dynamic v) => v is Map ? v['_id'] as String? : v as String?;
  static Map<String, dynamic>? refObj(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : null;
}

class Category extends JsonModel {
  Category(super.json, {super.local});
  String get name => s('name');
  String? get nameUr => os('nameUr');
  String? get key => os('key');
  bool get archived => json['archivedAt'] != null;
  String label(bool urdu) => urdu && (nameUr?.isNotEmpty ?? false) ? nameUr! : name;
}

class Requirement {
  Requirement(this.json);
  final Map<String, dynamic> json;
  String get purpose => (json['purpose'] as String?) ?? 'PURCHASE';
  List<String> get propertyTypes => ((json['propertyTypes'] as List?) ?? const []).cast<String>();
  List<String> get areas => ((json['areas'] as List?) ?? const []).cast<String>();
  List<String> get societies => ((json['societies'] as List?) ?? const []).cast<String>();
  List<String> get blocks => ((json['blocks'] as List?) ?? const []).cast<String>();
  num? get minSize => json['minSize'] as num?;
  num? get maxSize => json['maxSize'] as num?;
  String? get sizeUnit => json['sizeUnit'] as String?;
  num? get minBudget => json['minBudget'] as num?;
  num? get maxBudget => json['maxBudget'] as num?;
  bool get isPrimary => json['isPrimary'] == true;
}

class Client extends JsonModel {
  Client(super.json, {super.local});
  String get fullName => s('fullName');
  String get mobileNumber => s('mobileNumber');
  String? get whatsappNumber => os('whatsappNumber');
  String? get alternateNumber => os('alternateNumber');
  String? get email => os('email');
  String? get address => os('address');
  String? get categoryId => JsonModel.refId(json['categoryId']);
  String get status => (json['status'] as String?) ?? 'ACTIVE';
  String get priority => (json['priority'] as String?) ?? 'MEDIUM';
  String? get source => os('source');
  String? get assignedTo => JsonModel.refId(json['assignedTo']);
  String? get notes => os('notes');
  String? get preferredSociety => os('preferredSociety');
  String? get preferredArea => os('preferredArea');
  num? get minBudget => n('minBudget');
  num? get maxBudget => n('maxBudget');
  String? get purpose => os('purchaseOrRental');
  int get matchCount => n('matchCount')?.toInt() ?? 0;
  DateTime? get lastContactedAt => parseDate(json['lastContactedAt']);
  List<Requirement> get requirements =>
      ((json['requirements'] as List?) ?? const []).map((r) => Requirement(Map<String, dynamic>.from(r as Map))).toList();
  String get whatsapp => whatsappNumber ?? mobileNumber;
}

class Owner extends JsonModel {
  Owner(super.json, {super.local});
  String get fullName => s('fullName');
  String get mobileNumber => s('mobileNumber');
  String? get whatsappNumber => os('whatsappNumber');
  String? get email => os('email');
  String? get address => os('address');
  String? get notes => os('notes');
  int get propertyCount => n('propertyCount')?.toInt() ?? 0;
}

class Property extends JsonModel {
  Property(super.json, {super.local});
  String? get propertyId => os('propertyId');
  String get propertyType => (json['propertyType'] as String?) ?? 'OTHER';
  String get listingPurpose => (json['listingPurpose'] as String?) ?? 'SALE';
  String get status => (json['status'] as String?) ?? 'AVAILABLE';
  String? get title => os('title');
  String? get area => os('area');
  String? get society => os('society');
  String? get block => os('block');
  String? get street => os('street');
  String? get plotNumber => os('plotNumber');
  num get size => n('size') ?? 0;
  String get sizeUnit => (json['sizeUnit'] as String?) ?? 'SQ_YARD';
  num get askingPrice => n('askingPrice') ?? 0;
  num? get minimumPrice => n('minimumPrice');
  num? get expectedFinalPrice => n('expectedFinalPrice');
  bool get negotiable => json['negotiable'] != false;
  String? get ownerId => JsonModel.refId(json['ownerId']);
  String? get description => os('description');
  double? get latitude => n('latitude')?.toDouble();
  double? get longitude => n('longitude')?.toDouble();
  String? get googleMapsUrl => os('googleMapsUrl');
  int? get bedrooms => n('bedrooms')?.toInt();
  int? get bathrooms => n('bathrooms')?.toInt();
  int? get floors => n('floors')?.toInt();
  String? get coverImageUrl => os('coverImageUrl');
  String? get coverThumbnailUrl => os('coverThumbnailUrl');
  DateTime? get lastVerifiedAt => parseDate(json['lastVerifiedAt']);

  /// Available but not re-confirmed with the owner in the last 30 days (same rule as the API).
  bool get needsVerification => status == 'AVAILABLE' && (lastVerifiedAt == null || DateTime.now().difference(lastVerifiedAt!).inDays > 30);
  int get matchCount => n('matchCount')?.toInt() ?? 0;
  String get location => [block, society ?? area].whereType<String>().where((e) => e.isNotEmpty).join(', ');
  bool get hasLocation => latitude != null && longitude != null;
}

class FollowUp extends JsonModel {
  FollowUp(super.json, {super.local});
  String? get clientId => JsonModel.refId(json['clientId']);
  String? get propertyId => JsonModel.refId(json['propertyId']);
  Map<String, dynamic>? get client => JsonModel.refObj(json['clientId']);
  Map<String, dynamic>? get property => JsonModel.refObj(json['propertyId']);
  String get type => (json['type'] as String?) ?? 'GENERAL';
  DateTime get dueAt => parseDate(json['dueAt']) ?? DateTime.now();
  String get priority => (json['priority'] as String?) ?? 'MEDIUM';
  String? get notes => os('notes');
  String? get assignedTo => JsonModel.refId(json['assignedTo']);
  String get status {
    final st = (json['status'] as String?) ?? 'PENDING';
    // Overdue is also derived locally, so it shows even before the server job runs.
    return st == 'PENDING' && dueAt.isBefore(DateTime.now()) ? 'OVERDUE' : st;
  }

  bool get isOpen => status == 'PENDING' || status == 'OVERDUE';
  String? get outcome => os('outcome');
}

class Note extends JsonModel {
  Note(super.json, {super.local});
  String get content => s('content');
  String? get authorId => JsonModel.refId(json['createdBy']);
  String? get entityType => os('entityType');
  String? get entityId => os('entityId');
}

class Match {
  Match(this.json);
  final Map<String, dynamic> json;
  String get id => json['_id'] as String;
  int get score => (json['matchScore'] as num).toInt();
  String get band => json['band'] as String;
  String get status => json['status'] as String;
  Map<String, dynamic> get client => Map<String, dynamic>.from(json['clientId'] as Map);
  Map<String, dynamic> get property => Map<String, dynamic>.from(json['propertyId'] as Map);
  List<Map<String, dynamic>> get reasons => ((json['matchReasons'] as List?) ?? const []).map((r) => Map<String, dynamic>.from(r as Map)).toList();
}

class AppNotification {
  AppNotification(this.json);
  final Map<String, dynamic> json;
  String get id => json['_id'] as String;
  String get category => json['category'] as String;
  String get title => json['title'] as String;
  String get body => json['body'] as String;
  String? get deepLink => json['deepLink'] as String?;
  bool get read => json['readAt'] != null;
  DateTime get createdAt => parseDate(json['createdAt']) ?? DateTime.now();
}
