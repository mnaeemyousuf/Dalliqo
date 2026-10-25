import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../core/database/app_database.dart';
import '../core/models/models.dart';
import '../core/network/api_client.dart';
import '../core/providers.dart';
import '../core/sync/local_store.dart';

/// Marks "leave this field unchanged" in the filters' copyWith, so null can mean "clear".
const _keep = Object();

/// Square feet per unit (the API's defaults), used to compare sizes across units offline.
const sqftPerUnit = {'SQ_FT': 1.0, 'SQ_YARD': 9.0, 'SQ_METER': 10.7639, 'MARLA': 225.0, 'KANAL': 4500.0};

bool _contains(Object? haystack, String needle) {
  final n = needle.toLowerCase();
  if (haystack is String) return haystack.toLowerCase().contains(n);
  if (haystack is List) return haystack.any((e) => e is String && e.toLowerCase().contains(n));
  return false;
}

/// Filters for the client list (all evaluated against the local database,
/// with the same semantics as the API's `GET /clients`).
class ClientFilter {
  const ClientFilter({
    this.search = '',
    this.categoryId,
    this.status,
    this.purpose,
    this.propertyType,
    this.area,
    this.minBudget,
    this.maxBudget,
    this.assignedTo,
    this.sort = 'updated',
  });
  final String search;
  final String? categoryId;
  final String? status;
  final String? purpose;
  final String? propertyType;
  final String? area;
  final num? minBudget;
  final num? maxBudget;
  final String? assignedTo;
  final String sort;

  ClientFilter copyWith({
    String? search,
    Object? categoryId = _keep,
    Object? status = _keep,
    Object? purpose = _keep,
    Object? propertyType = _keep,
    Object? area = _keep,
    Object? minBudget = _keep,
    Object? maxBudget = _keep,
    Object? assignedTo = _keep,
    String? sort,
  }) =>
      ClientFilter(
        search: search ?? this.search,
        categoryId: identical(categoryId, _keep) ? this.categoryId : categoryId as String?,
        status: identical(status, _keep) ? this.status : status as String?,
        purpose: identical(purpose, _keep) ? this.purpose : purpose as String?,
        propertyType: identical(propertyType, _keep) ? this.propertyType : propertyType as String?,
        area: identical(area, _keep) ? this.area : area as String?,
        minBudget: identical(minBudget, _keep) ? this.minBudget : minBudget as num?,
        maxBudget: identical(maxBudget, _keep) ? this.maxBudget : maxBudget as num?,
        assignedTo: identical(assignedTo, _keep) ? this.assignedTo : assignedTo as String?,
        sort: sort ?? this.sort,
      );

  /// Keeps the search text and sort order, drops every filter.
  ClientFilter cleared() => ClientFilter(search: search, sort: sort);

  bool get active => [categoryId, status, purpose, propertyType, area, minBudget, maxBudget, assignedTo].any((v) => v != null);

  bool matches(Map<String, dynamic> d) {
    final reqs = ((d['requirements'] as List?) ?? const []).whereType<Map>();
    final types = {...((d['propertyTypeRequired'] as List?) ?? const []), for (final r in reqs) ...((r['propertyTypes'] as List?) ?? const [])};
    final assigned = d['assignedTo'] is Map ? (d['assignedTo'] as Map)['_id'] : d['assignedTo'];
    final cMin = d['minBudget'] as num?;
    final cMax = d['maxBudget'] as num?;
    return (categoryId == null || d['categoryId'] == categoryId || (d['categoryId'] is Map && (d['categoryId'] as Map)['_id'] == categoryId)) &&
        (status == null || d['status'] == status) &&
        (purpose == null || d['purchaseOrRental'] == purpose) &&
        (propertyType == null || types.contains(propertyType)) &&
        (area == null ||
            _contains(d['preferredArea'], area!) ||
            _contains(d['preferredSociety'], area!) ||
            reqs.any((r) => _contains(r['areas'], area!) || _contains(r['societies'], area!))) &&
        // Budget ranges overlap the requested range (open-ended ranges always overlap).
        (minBudget == null || cMax == null || cMax >= minBudget!) &&
        (maxBudget == null || cMin == null || cMin <= maxBudget!) &&
        (assignedTo == null || assigned == assignedTo);
  }

  @override
  bool operator ==(Object other) =>
      other is ClientFilter &&
      other.search == search &&
      other.categoryId == categoryId &&
      other.status == status &&
      other.purpose == purpose &&
      other.propertyType == propertyType &&
      other.area == area &&
      other.minBudget == minBudget &&
      other.maxBudget == maxBudget &&
      other.assignedTo == assignedTo &&
      other.sort == sort;

  @override
  int get hashCode => Object.hash(search, categoryId, status, purpose, propertyType, area, minBudget, maxBudget, assignedTo, sort);
}

/// Filters for the property list (local, same semantics as `GET /properties`).
class PropertyFilter {
  const PropertyFilter({
    this.search = '',
    this.type,
    this.status,
    this.purpose,
    this.area,
    this.society,
    this.block,
    this.minPrice,
    this.maxPrice,
    this.minSize,
    this.maxSize,
    this.sizeUnit = 'SQ_YARD',
    this.ownerId,
    this.needsVerification = false,
    this.sort = 'updated',
  });
  final bool needsVerification;
  final String search;
  final String? type;
  final String? status;
  final String? purpose;
  final String? area;
  final String? society;
  final String? block;
  final num? minPrice;
  final num? maxPrice;
  final num? minSize;
  final num? maxSize;
  final String sizeUnit;
  final String? ownerId;
  final String sort;

  PropertyFilter copyWith({
    String? search,
    Object? type = _keep,
    Object? status = _keep,
    Object? purpose = _keep,
    Object? area = _keep,
    Object? society = _keep,
    Object? block = _keep,
    Object? minPrice = _keep,
    Object? maxPrice = _keep,
    Object? minSize = _keep,
    Object? maxSize = _keep,
    String? sizeUnit,
    Object? ownerId = _keep,
    bool? needsVerification,
    String? sort,
  }) =>
      PropertyFilter(
        needsVerification: needsVerification ?? this.needsVerification,
        search: search ?? this.search,
        type: identical(type, _keep) ? this.type : type as String?,
        status: identical(status, _keep) ? this.status : status as String?,
        purpose: identical(purpose, _keep) ? this.purpose : purpose as String?,
        area: identical(area, _keep) ? this.area : area as String?,
        society: identical(society, _keep) ? this.society : society as String?,
        block: identical(block, _keep) ? this.block : block as String?,
        minPrice: identical(minPrice, _keep) ? this.minPrice : minPrice as num?,
        maxPrice: identical(maxPrice, _keep) ? this.maxPrice : maxPrice as num?,
        minSize: identical(minSize, _keep) ? this.minSize : minSize as num?,
        maxSize: identical(maxSize, _keep) ? this.maxSize : maxSize as num?,
        sizeUnit: sizeUnit ?? this.sizeUnit,
        ownerId: identical(ownerId, _keep) ? this.ownerId : ownerId as String?,
        sort: sort ?? this.sort,
      );

  PropertyFilter cleared() => PropertyFilter(search: search, sort: sort, sizeUnit: sizeUnit);

  bool get active => needsVerification || [type, status, purpose, area, society, block, minPrice, maxPrice, minSize, maxSize, ownerId].any((v) => v != null);

  bool matches(Map<String, dynamic> d) {
    final price = (d['askingPrice'] as num?) ?? 0;
    final owner = d['ownerId'] is Map ? (d['ownerId'] as Map)['_id'] : d['ownerId'];
    final sqft = (d['sizeSqft'] as num?) ?? ((d['size'] as num?) ?? 0) * (sqftPerUnit[d['sizeUnit']] ?? 1);
    final per = sqftPerUnit[sizeUnit] ?? 1;
    return (type == null || d['propertyType'] == type) &&
        (status == null || d['status'] == status) &&
        (purpose == null || d['listingPurpose'] == purpose) &&
        (area == null || _contains(d['area'], area!)) &&
        (society == null || _contains(d['society'], society!)) &&
        (block == null || _contains(d['block'], block!)) &&
        (minPrice == null || price >= minPrice!) &&
        (maxPrice == null || price <= maxPrice!) &&
        (minSize == null || sqft >= minSize! * per) &&
        (maxSize == null || sqft <= maxSize! * per) &&
        (ownerId == null || owner == ownerId) &&
        (!needsVerification || Property(d).needsVerification);
  }

  @override
  bool operator ==(Object other) =>
      other is PropertyFilter &&
      other.search == search &&
      other.type == type &&
      other.status == status &&
      other.purpose == purpose &&
      other.area == area &&
      other.society == society &&
      other.block == block &&
      other.minPrice == minPrice &&
      other.maxPrice == maxPrice &&
      other.minSize == minSize &&
      other.maxSize == maxSize &&
      other.sizeUnit == sizeUnit &&
      other.ownerId == ownerId &&
      other.needsVerification == needsVerification &&
      other.sort == sort;

  @override
  int get hashCode => Object.hash(search, type, status, purpose, area, society, block, minPrice, maxPrice, minSize, maxSize, sizeUnit, ownerId, needsVerification, sort);
}

/// Offline-first CRUD for the synced entities.
class CrmRepository {
  CrmRepository(this.db, this.store);

  final AppDatabase db;
  final LocalStore store;

  // Categories
  Future<List<Category>> categories() async {
    final rows = await db.list(Entities.categories, where: (d) => d['archivedAt'] == null);
    rows.sort((a, b) => ((a.data['sortOrder'] as num?) ?? 0).compareTo((b.data['sortOrder'] as num?) ?? 0));
    return rows.map((r) => Category(r.data, local: r)).toList();
  }

  // Clients
  Future<List<Client>> clients(ClientFilter f, {int limit = 30, int offset = 0}) async {
    final rows = await db.list(
      Entities.clients,
      search: f.search,
      where: f.matches,
      sort: switch (f.sort) {
        'name' => (a, b) => (a.data['fullName'] as String? ?? '').toLowerCase().compareTo((b.data['fullName'] as String? ?? '').toLowerCase()),
        'matches' => (a, b) => ((b.data['matchCount'] as num?) ?? 0).compareTo((a.data['matchCount'] as num?) ?? 0),
        _ => null,
      },
      limit: limit,
      offset: offset,
    );
    return rows.map((r) => Client(r.data, local: r)).toList();
  }

  Future<Client?> client(String id) async {
    final r = await db.get(Entities.clients, id);
    return r == null || r.deleted ? null : Client(r.data, local: r);
  }

  /// Local clients already using any of these numbers (mobile, WhatsApp or alternate).
  /// Works offline, so the warning shows before the client is queued for sync.
  Future<List<Client>> clientsWithPhones(Iterable<String?> phones, {String? exceptId}) async {
    final wanted = phones.whereType<String>().where((p) => p.isNotEmpty).toSet();
    if (wanted.isEmpty) return const [];
    final rows = await db.list(Entities.clients, where: (d) => [d['mobileNumber'], d['whatsappNumber'], d['alternateNumber']].any(wanted.contains), limit: 5);
    return rows.where((r) => exceptId == null || (r.uuid != exceptId && r.serverId != exceptId)).map((r) => Client(r.data, local: r)).toList();
  }

  Future<Client> saveClient(Map<String, dynamic> fields, {String? id}) async {
    final r = id == null ? await store.create(Entities.clients, fields) : await store.update(Entities.clients, id, fields);
    return Client(r.data, local: r);
  }

  Future<void> deleteClient(String id) => store.delete(Entities.clients, id);

  // Owners
  Future<List<Owner>> owners({String search = '', int limit = 50, int offset = 0}) async {
    final rows = await db.list(Entities.owners, search: search, limit: limit, offset: offset);
    return rows.map((r) => Owner(r.data, local: r)).toList();
  }

  Future<Owner?> owner(String id) async {
    final r = await db.get(Entities.owners, id);
    return r == null || r.deleted ? null : Owner(r.data, local: r);
  }

  Future<Owner> saveOwner(Map<String, dynamic> fields, {String? id}) async {
    final r = id == null ? await store.create(Entities.owners, fields) : await store.update(Entities.owners, id, fields);
    return Owner(r.data, local: r);
  }

  Future<void> deleteOwner(String id) => store.delete(Entities.owners, id);

  // Properties
  Future<List<Property>> properties(PropertyFilter f, {int limit = 30, int offset = 0}) async {
    final rows = await db.list(
      Entities.properties,
      search: f.search,
      where: f.matches,
      sort: switch (f.sort) {
        'priceAsc' => (a, b) => ((a.data['askingPrice'] as num?) ?? 0).compareTo((b.data['askingPrice'] as num?) ?? 0),
        'priceDesc' => (a, b) => ((b.data['askingPrice'] as num?) ?? 0).compareTo((a.data['askingPrice'] as num?) ?? 0),
        'matches' => (a, b) => ((b.data['matchCount'] as num?) ?? 0).compareTo((a.data['matchCount'] as num?) ?? 0),
        _ => null,
      },
      limit: limit,
      offset: offset,
    );
    return rows.map((r) => Property(r.data, local: r)).toList();
  }

  Future<Property?> property(String id) async {
    final r = await db.get(Entities.properties, id);
    return r == null || r.deleted ? null : Property(r.data, local: r);
  }

  Future<Property> saveProperty(Map<String, dynamic> fields, {String? id}) async {
    final r = id == null ? await store.create(Entities.properties, fields) : await store.update(Entities.properties, id, fields);
    return Property(r.data, local: r);
  }

  Future<void> deleteProperty(String id) => store.delete(Entities.properties, id);

  // Follow-ups
  Future<List<FollowUp>> followUps({String? clientId, String? propertyId, String? assignedTo, String? status}) async {
    final rows = await db.list(Entities.followUps, where: (d) {
      final f = FollowUp(d);
      return (clientId == null || f.clientId == clientId) &&
          (propertyId == null || f.propertyId == propertyId) &&
          (assignedTo == null || f.assignedTo == assignedTo) &&
          (status == null || f.status == status);
    });
    final items = rows.map((r) => FollowUp(r.data, local: r)).toList()..sort((a, b) => a.dueAt.compareTo(b.dueAt));
    return items;
  }

  Future<FollowUp?> followUp(String id) async {
    final r = await db.get(Entities.followUps, id);
    return r == null || r.deleted ? null : FollowUp(r.data, local: r);
  }

  Future<FollowUp> saveFollowUp(Map<String, dynamic> fields, {String? id}) async {
    final r = id == null ? await store.create(Entities.followUps, fields) : await store.update(Entities.followUps, id, fields);
    return FollowUp(r.data, local: r);
  }

  /// Completing works offline; the server records the activity when it syncs.
  Future<void> completeFollowUp(String id, {String? outcome}) =>
      store.update(Entities.followUps, id, {'status': 'COMPLETED', if (outcome != null && outcome.isNotEmpty) 'outcome': outcome});

  Future<void> cancelFollowUp(String id) => store.update(Entities.followUps, id, {'status': 'CANCELLED'});

  /// Moving the due time works offline; the server recalculates the reminder and status on sync.
  Future<void> rescheduleFollowUp(String id, DateTime dueAt) => store.update(Entities.followUps, id, {'dueAt': dueAt.toUtc().toIso8601String()});

  // Notes
  Future<List<Note>> notes(String entityType, String entityId) async {
    final rows = await db.list(Entities.notes, where: (d) => d['entityType'] == entityType && d['entityId'] == entityId);
    return rows.map((r) => Note(r.data, local: r)).toList();
  }

  Future<Note> addNote(String entityType, String entityId, String content) async {
    final r = await store.create(Entities.notes, {'entityType': entityType, 'entityId': entityId, 'content': content});
    return Note(r.data, local: r);
  }

  Future<void> deleteNote(String id) => store.delete(Entities.notes, id);
}

final crmRepositoryProvider = Provider<CrmRepository>((ref) => CrmRepository(ref.watch(databaseProvider), ref.watch(localStoreProvider)));

/// Server-only features (computed on the server, need a connection).
/// Results are cached so the last view is still visible offline.
class OnlineRepository {
  OnlineRepository(this.api, this.db);

  final ApiClient api;
  final AppDatabase db;

  Future<({Map<String, dynamic> data, DateTime? cachedAt})> _cached(String key, Future<Map<String, dynamic>> Function() fetch) async {
    try {
      final data = await fetch();
      await db.setJson(key, {'at': DateTime.now().toIso8601String(), 'data': data});
      return (data: data, cachedAt: null);
    } on ApiException catch (e) {
      final hit = await db.getJson(key);
      if (e.isNetwork && hit != null) return (data: Map<String, dynamic>.from(hit['data'] as Map), cachedAt: DateTime.tryParse(hit['at'] as String));
      rethrow;
    }
  }

  Future<({Map<String, dynamic> data, DateTime? cachedAt})> dashboard() => _cached('cache.dashboard', () => api.get<Map<String, dynamic>>('/dashboard'));

  Future<({Map<String, dynamic> data, DateTime? cachedAt})> myDay(String scope) =>
      _cached('cache.myDay.$scope', () => api.get<Map<String, dynamic>>('/my-day', query: {'scope': scope}));

  Future<({List<Match> items, DateTime? cachedAt})> matches({String? clientId, String? propertyId, int? minScore}) async {
    final path = clientId != null ? '/clients/$clientId/matches' : propertyId != null ? '/properties/$propertyId/matches' : '/matches';
    final r = await _cached('cache.matches.${clientId ?? propertyId ?? 'all'}.$minScore', () async {
      final pg = await api.page(path, query: {'limit': 50, 'minScore': minScore});
      return {'items': pg.items};
    });
    return (items: (r.data['items'] as List).map((m) => Match(Map<String, dynamic>.from(m as Map))).toList(), cachedAt: r.cachedAt);
  }

  Future<void> setMatchStatus(String id, String status) => api.patch('/matches/$id', {'status': status});

  Future<List<Map<String, dynamic>>> activities(String entityId) async => (await api.page('/activities', query: {'entityId': entityId, 'limit': 100})).items;

  Future<void> logContact(String clientId, String channel) => api.post('/clients/$clientId/communications', {'channel': channel});

  Future<Map<String, dynamic>> changePropertyStatus(String id, String status, {String? reason}) =>
      api.post('/properties/$id/status', {'status': status, if (reason != null && reason.isNotEmpty) 'reason': reason});

  // Notifications
  Future<({List<AppNotification> items, int unread})> notifications({String? category}) async {
    final pg = await api.page('/notifications', query: {'category': category, 'limit': 50});
    return (items: pg.items.map(AppNotification.new).toList(), unread: (pg.meta['unreadCount'] as num?)?.toInt() ?? 0);
  }

  Future<void> markRead(String id) => api.post('/notifications/$id/read');
  Future<void> markAllRead() => api.post('/notifications/read-all');

  // Media & documents
  Future<List<Map<String, dynamic>>> media(String propertyId) async => (await api.get<List<dynamic>>('/properties/$propertyId/media')).cast<Map<String, dynamic>>();

  /// Images are compressed on the phone first (2048 px, JPEG 80) to save mobile data.
  Future<void> uploadMedia(String propertyId, List<File> files, {void Function(double)? onProgress}) async {
    final parts = <MultipartFile>[];
    for (final f in files) {
      final ext = p.extension(f.path).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.heic', '.webp'].contains(ext)) {
        final bytes = await FlutterImageCompress.compressWithFile(f.path, minWidth: 2048, minHeight: 2048, quality: 80, format: CompressFormat.jpeg);
        parts.add(MultipartFile.fromBytes(bytes ?? await f.readAsBytes(), filename: '${p.basenameWithoutExtension(f.path)}.jpg', contentType: DioMediaType('image', 'jpeg')));
      } else {
        parts.add(await MultipartFile.fromFile(f.path, filename: p.basename(f.path)));
      }
    }
    await api.upload('/properties/$propertyId/media', FormData.fromMap({'files': parts}), onProgress: onProgress);
  }

  Future<void> setCover(String mediaId) => api.patch('/media/$mediaId', {'setCover': true});
  Future<void> deleteMedia(String mediaId) => api.delete('/media/$mediaId');

  Future<List<Map<String, dynamic>>> documents(String entityType, String entityId) async =>
      (await api.page('/documents', query: {'entityType': entityType, 'entityId': entityId, 'limit': 100})).items;

  Future<void> uploadDocument(String entityType, String entityId, File file, String category, {void Function(double)? onProgress}) => api.upload(
        '/documents',
        FormData.fromMap({'entityType': entityType, 'entityId': entityId, 'category': category, 'file': MultipartFile.fromFileSync(file.path, filename: p.basename(file.path))}),
        onProgress: onProgress,
      );

  Future<String> documentUrl(String id) async => (await api.get<Map<String, dynamic>>('/documents/$id/download'))['url'] as String;
  Future<void> deleteDocument(String id) => api.delete('/documents/$id');

  /// Records that availability was re-confirmed with the owner (server-side, needs a connection).
  Future<void> verifyProperty(String serverId, {String? note}) => api.post('/properties/$serverId/verify', {if (note != null && note.isNotEmpty) 'note': note});

  Future<void> renameDocument(String id, String fileName) => api.patch('/documents/$id', {'fileName': fileName});

  // Exports: saved to a temp file, then shared (WhatsApp, email, Drive…).
  Future<File> export(String resource, String format) async {
    final r = await api.download('/exports/$resource', query: {'format': format});
    final dir = await getTemporaryDirectory();
    final file = File(p.join(dir.path, r.fileName));
    await file.writeAsBytes(r.bytes, flush: true);
    return file;
  }

  // Members (read-only on mobile; permissions are edited in the web CRM)
  Future<List<Map<String, dynamic>>> members() async {
    try {
      final items = (await api.page('/members', query: {'limit': 100})).items;
      await db.setJson('session.members', {'items': items});
      return items;
    } on ApiException catch (e) {
      final hit = await db.getJson('session.members');
      if (e.isNetwork && hit != null) return (hit['items'] as List).cast<Map<String, dynamic>>();
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> sessions() async => (await api.get<List<dynamic>>('/auth/sessions')).cast<Map<String, dynamic>>();
  Future<void> revokeSession(String id) => api.delete('/auth/sessions/$id');
}

final onlineRepositoryProvider = Provider<OnlineRepository>((ref) => OnlineRepository(ref.watch(apiClientProvider), ref.watch(databaseProvider)));
