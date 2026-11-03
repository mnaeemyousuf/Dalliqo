import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../core/branch/branch_scope.dart';
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
class FinanceRow {
  FinanceRow(this.key, this.category);
  final String key;
  final MoneyCategory? category;
  int income = 0;
  int expense = 0;
  int count = 0;
  int get net => income - expense;
}

class FinanceSummary {
  FinanceSummary(this.rows);
  final List<FinanceRow> rows;
  int get income => rows.fold(0, (s, r) => s + r.income);
  int get expense => rows.fold(0, (s, r) => s + r.expense);
  int get net => income - expense;
}

class ClientFilter {
  const ClientFilter({
    this.search = '',
    this.categoryId,
    this.status,
    this.purpose,
    this.propertyType,
    this.area,
    this.block,
    this.minBudget,
    this.maxBudget,
    this.minSize,
    this.maxSize,
    this.sizeUnit = 'SQ_YARD',
    this.assignedTo,
    this.sort = 'updated',
  });
  final String search;
  final String? categoryId;
  final String? status;
  final String? purpose;
  final String? propertyType;
  final String? area;
  final String? block;
  final num? minBudget;
  final num? maxBudget;

  /// Requested size range in [sizeUnit]; compared in sq ft against each requirement's range.
  final num? minSize;
  final num? maxSize;
  final String sizeUnit;
  final String? assignedTo;
  final String sort;

  ClientFilter copyWith({
    String? search,
    Object? categoryId = _keep,
    Object? status = _keep,
    Object? purpose = _keep,
    Object? propertyType = _keep,
    Object? area = _keep,
    Object? block = _keep,
    Object? minBudget = _keep,
    Object? maxBudget = _keep,
    Object? minSize = _keep,
    Object? maxSize = _keep,
    String? sizeUnit,
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
        block: identical(block, _keep) ? this.block : block as String?,
        minBudget: identical(minBudget, _keep) ? this.minBudget : minBudget as num?,
        maxBudget: identical(maxBudget, _keep) ? this.maxBudget : maxBudget as num?,
        minSize: identical(minSize, _keep) ? this.minSize : minSize as num?,
        maxSize: identical(maxSize, _keep) ? this.maxSize : maxSize as num?,
        sizeUnit: sizeUnit ?? this.sizeUnit,
        assignedTo: identical(assignedTo, _keep) ? this.assignedTo : assignedTo as String?,
        sort: sort ?? this.sort,
      );

  /// Keeps the search text, sort order and size unit, drops every filter.
  ClientFilter cleared() => ClientFilter(search: search, sort: sort, sizeUnit: sizeUnit);

  bool get active => [categoryId, status, purpose, propertyType, area, block, minBudget, maxBudget, minSize, maxSize, assignedTo].any((v) => v != null);

  /// Same rule as the API: a requirement matches when its size range overlaps the requested one
  /// (open ends overlap) and it states at least one bound. Offline-created requirements may not
  /// have the server's sq ft values yet, so they are computed from size + unit.
  bool _sizeMatches(Iterable<Map> reqs) {
    if (minSize == null && maxSize == null) return true;
    final per = sqftPerUnit[sizeUnit] ?? 1;
    final lo = minSize == null ? null : minSize! * per;
    final hi = maxSize == null ? null : maxSize! * per;
    num? sqft(Map r, String k) {
      final stored = r['${k}Sqft'] as num?;
      if (stored != null) return stored;
      final v = r[k] as num?;
      return v == null ? null : v * (sqftPerUnit[r['sizeUnit']] ?? sqftPerUnit['SQ_YARD']!);
    }

    return reqs.any((r) {
      final rMin = sqft(r, 'minSize');
      final rMax = sqft(r, 'maxSize');
      if (rMin == null && rMax == null) return false;
      return (lo == null || rMax == null || rMax >= lo) && (hi == null || rMin == null || rMin <= hi);
    });
  }

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
        (block == null || _contains(d['preferredBlock'], block!) || reqs.any((r) => _contains(r['blocks'], block!))) &&
        _sizeMatches(reqs) &&
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
      other.block == block &&
      other.minBudget == minBudget &&
      other.maxBudget == maxBudget &&
      other.minSize == minSize &&
      other.maxSize == maxSize &&
      other.sizeUnit == sizeUnit &&
      other.assignedTo == assignedTo &&
      other.sort == sort;

  @override
  int get hashCode => Object.hash(search, categoryId, status, purpose, propertyType, area, block, minBudget, maxBudget, minSize, maxSize, sizeUnit, assignedTo, sort);
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
  CrmRepository(this.db, this.store, {this.branch});

  final AppDatabase db;
  final LocalStore store;

  /// Branch switcher: lists show only the selected branch; new records go to it.
  final BranchScope? branch;

  bool _inBranch(Map<String, dynamic> d) => branch?.contains(d) ?? true;

  /// Adds the branch to a record created on this phone (the server applies the same default).
  Map<String, dynamic> _withBranch(Map<String, dynamic> fields) {
    if (fields['branchId'] != null) return fields;
    final b = branch?.branchForNewRecord();
    return b == null ? fields : {...fields, 'branchId': b};
  }

  // Branches
  Future<List<Branch>> branches() async => branch?.branches ?? (await db.list(Entities.branches)).map((r) => Branch(r.data, local: r)).toList();

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
      where: (d) => _inBranch(d) && f.matches(d),
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
    final r = id == null ? await store.create(Entities.clients, _withBranch(fields)) : await store.update(Entities.clients, id, fields);
    return Client(r.data, local: r);
  }

  Future<void> deleteClient(String id) => store.delete(Entities.clients, id);

  // Owners
  Future<List<Owner>> owners({String search = '', int limit = 50, int offset = 0}) async {
    final rows = await db.list(Entities.owners, search: search, where: _inBranch, limit: limit, offset: offset);
    return rows.map((r) => Owner(r.data, local: r)).toList();
  }

  Future<Owner?> owner(String id) async {
    final r = await db.get(Entities.owners, id);
    return r == null || r.deleted ? null : Owner(r.data, local: r);
  }

  Future<Owner> saveOwner(Map<String, dynamic> fields, {String? id}) async {
    final r = id == null ? await store.create(Entities.owners, _withBranch(fields)) : await store.update(Entities.owners, id, fields);
    return Owner(r.data, local: r);
  }

  Future<void> deleteOwner(String id) => store.delete(Entities.owners, id);

  // Properties
  Future<List<Property>> properties(PropertyFilter f, {int limit = 30, int offset = 0}) async {
    final rows = await db.list(
      Entities.properties,
      search: f.search,
      where: (d) => _inBranch(d) && f.matches(d),
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
    final r = id == null ? await store.create(Entities.properties, _withBranch(fields)) : await store.update(Entities.properties, id, fields);
    return Property(r.data, local: r);
  }

  Future<void> deleteProperty(String id) => store.delete(Entities.properties, id);

  // Follow-ups
  Future<List<FollowUp>> followUps({String? clientId, String? propertyId, String? assignedTo, String? status}) async {
    final rows = await db.list(Entities.followUps, where: (d) {
      final f = FollowUp(d);
      // On a client/property screen show all of its follow-ups; lists follow the branch switcher.
      return (clientId != null || propertyId != null || _inBranch(d)) &&
          (clientId == null || f.clientId == clientId) &&
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
    if (id == null && fields['branchId'] == null && fields['clientId'] is String) {
      // A follow-up belongs to its client's branch (the server does the same).
      final c = await db.get(Entities.clients, fields['clientId'] as String);
      final b = JsonModel.refId(c?.data['branchId']) ?? branch?.defaultId;
      if (b != null) fields = {...fields, 'branchId': b};
    }
    final r = id == null ? await store.create(Entities.followUps, fields) : await store.update(Entities.followUps, id, fields);
    return FollowUp(r.data, local: r);
  }

  /// Completing works offline; the server records the activity when it syncs.
  Future<void> completeFollowUp(String id, {String? outcome}) =>
      store.update(Entities.followUps, id, {'status': 'COMPLETED', if (outcome != null && outcome.isNotEmpty) 'outcome': outcome});

  Future<void> cancelFollowUp(String id) => store.update(Entities.followUps, id, {'status': 'CANCELLED'});

  /// Moving the due time works offline; the server recalculates the reminder and status on sync.
  Future<void> rescheduleFollowUp(String id, DateTime dueAt) => store.update(Entities.followUps, id, {'dueAt': dueAt.toUtc().toIso8601String()});

  // Income & expense (entries are recorded offline; categories are synced from the server)
  Future<List<MoneyCategory>> moneyCategories({String? type, bool includeArchived = false}) async {
    final rows = await db.list(Entities.transactionCategories, where: (d) => (includeArchived || d['archivedAt'] == null) && (type == null || d['type'] == type));
    final items = rows.map((r) => MoneyCategory(r.data, local: r)).toList();
    items.sort((a, b) => a.type != b.type ? a.type.compareTo(b.type) : ((a.json['sortOrder'] as num?) ?? 100).compareTo((b.json['sortOrder'] as num?) ?? 100));
    return items;
  }

  Future<List<MoneyEntry>> moneyEntries({String search = '', String? type, String? categoryId, String? dealId, DateTime? from, DateTime? to}) async {
    final q = search.trim().toLowerCase();
    final rows = await db.list(Entities.transactions, where: (d) {
      final x = MoneyEntry(d);
      return _inBranch(d) &&
          (type == null || x.type == type) &&
          (categoryId == null || x.categoryId == categoryId) &&
          (dealId == null || x.dealId == dealId) &&
          (from == null || !x.date.isBefore(from)) &&
          (to == null || !x.date.isAfter(to)) &&
          (q.isEmpty || '${x.description ?? ''} ${x.reference ?? ''}'.toLowerCase().contains(q));
    });
    return rows.map((r) => MoneyEntry(r.data, local: r)).toList()..sort((a, b) => b.date.compareTo(a.date));
  }

  Future<MoneyEntry?> moneyEntry(String id) async {
    final r = await db.get(Entities.transactions, id);
    return r == null || r.deleted ? null : MoneyEntry(r.data, local: r);
  }

  Future<MoneyEntry> saveMoneyEntry(Map<String, dynamic> fields, {String? id}) async {
    if (id != null && (await moneyEntry(id))?.fromCommission == true) throw StateError('Commission income is changed on its deal');
    if (id == null) fields = {'method': 'CASH', ...fields};
    final r = id == null ? await store.create(Entities.transactions, _withBranch(fields)) : await store.update(Entities.transactions, id, fields);
    return MoneyEntry(r.data, local: r);
  }

  Future<void> deleteMoneyEntry(String id) async {
    if ((await moneyEntry(id))?.fromCommission == true) throw StateError('Commission income is removed with its payment on the deal');
    await store.delete(Entities.transactions, id);
  }

  /// Income, expense and net by month (yyyy-MM) or category, from the entries on this phone
  /// (same figures as GET /reports/finance once everything is synced).
  Future<FinanceSummary> financeSummary({String groupBy = 'month', DateTime? from, DateTime? to}) async {
    final entries = await moneyEntries(from: from, to: to);
    final cats = {for (final c in await moneyCategories(includeArchived: true)) c.id: c};
    final rows = <String, FinanceRow>{};
    for (final e in entries) {
      final local = e.date.toUtc().add(const Duration(hours: 5)); // Asia/Karachi, like the server
      final key = groupBy == 'month' ? '${local.year}-${local.month.toString().padLeft(2, '0')}' : (e.categoryId ?? '');
      final row = rows.putIfAbsent(key, () => FinanceRow(key, cats[key]));
      if (e.isIncome) {
        row.income += e.amount;
      } else {
        row.expense += e.amount;
      }
      row.count++;
    }
    final list = rows.values.toList()
      ..sort((a, b) => groupBy == 'month' ? a.key.compareTo(b.key) : (b.income + b.expense).compareTo(a.income + a.expense));
    return FinanceSummary(list);
  }

  // Agreements: drafts, edits and status changes work offline; the server renders the text when they sync.
  Future<List<AgreementTemplateModel>> agreementTemplates({String? kind, String? language}) async {
    final rows = await db.list(Entities.agreementTemplates, where: (d) => d['archivedAt'] == null && (kind == null || d['kind'] == kind) && (language == null || d['language'] == language));
    return rows.map((r) => AgreementTemplateModel(r.data, local: r)).toList()..sort((a, b) => (b.builtIn ? 1 : 0).compareTo(a.builtIn ? 1 : 0));
  }

  Future<List<Agreement>> agreements({String search = '', String? status, String? kind, String? clientId, String? propertyId, String? dealId, bool expiringSoon = false}) async {
    final q = search.trim().toLowerCase();
    final soon = DateTime.now().add(const Duration(days: 30));
    final rows = await db.list(Entities.agreements, where: (d) {
      final a = Agreement(d);
      return (clientId != null || propertyId != null || dealId != null || _inBranch(d)) &&
          (status == null || a.status == status) &&
          (kind == null || a.kind == kind) &&
          (clientId == null || a.clientId == clientId) &&
          (propertyId == null || a.propertyId == propertyId) &&
          (dealId == null || a.dealId == dealId) &&
          (!expiringSoon || (a.status == 'SIGNED' && a.endDate != null && a.endDate!.isAfter(DateTime.now()) && a.endDate!.isBefore(soon))) &&
          (q.isEmpty || '${a.agreementNo} ${a.title ?? ''} ${(d['clientId'] is Map ? d['clientId']['fullName'] : '') ?? ''}'.toLowerCase().contains(q));
    });
    return rows.map((r) => Agreement(r.data, local: r)).toList()..sort((a, b) => (b.updatedAt ?? DateTime(0)).compareTo(a.updatedAt ?? DateTime(0)));
  }

  Future<Agreement?> agreement(String id) async {
    final r = await db.get(Entities.agreements, id);
    return r == null || r.deleted ? null : Agreement(r.data, local: r);
  }

  Future<Agreement> saveAgreement(Map<String, dynamic> fields, {String? id}) async {
    if (id != null && (await agreement(id))?.locked == true) throw StateError('This agreement is locked');
    if (id == null && fields['branchId'] == null && fields['clientId'] is String) {
      // Like the server: an agreement belongs to its client's branch.
      final c = await db.get(Entities.clients, fields['clientId'] as String);
      final b = JsonModel.refId(c?.data['branchId']) ?? branch?.defaultId;
      if (b != null) fields = {...fields, 'branchId': b};
    }
    final r = id == null ? await store.create(Entities.agreements, fields) : await store.update(Entities.agreements, id, fields);
    // Local-only bookkeeping for the list until the server's copy arrives.
    if (id == null) {
      await db.put(LocalRecord(entity: r.entity, uuid: r.uuid, serverId: r.serverId, version: r.version, data: {...r.data, 'status': 'DRAFT'}, syncStatus: r.syncStatus));
      return (await agreement(r.uuid))!;
    }
    return Agreement(r.data, local: r);
  }

  /// Status change offline (checked against the same transitions as the server; synced as a protected field).
  Future<void> changeAgreementStatus(String id, String status) async {
    final a = await agreement(id);
    if (a == null) return;
    // Its text is generated by the server, so a draft made on this phone must sync first.
    if (a.serverId == null) throw StateError('Sync this draft first');
    if (!a.nextStatuses.contains(status)) throw StateError('Cannot go from ${a.status} to $status');
    if (status == 'SIGNED' && a.versions.isEmpty) throw StateError('Generate the agreement text before marking it signed');
    await store.update(Entities.agreements, id, {'status': status});
  }

  Future<void> deleteAgreement(String id) async {
    if ((await agreement(id))?.status == 'SIGNED') throw StateError('A signed agreement cannot be deleted');
    await store.delete(Entities.agreements, id);
  }

  // Deals (edited offline; payments and payouts travel inside the deal, each with its own id)
  Future<List<Deal>> deals({String search = '', String? stage, bool? open, String? clientId, String? propertyId, String? agentId}) async {
    final rows = await db.list(Entities.deals, search: search, where: (d) {
      final x = Deal(d);
      return (clientId != null || propertyId != null || _inBranch(d)) &&
          (stage == null || x.stage == stage) &&
          (open == null || x.isOpen == open) &&
          (clientId == null || x.clientId == clientId) &&
          (propertyId == null || x.propertyId == propertyId) &&
          (agentId == null || x.hasAgent(agentId));
    });
    return rows.map((r) => Deal(r.data, local: r)).toList();
  }

  Future<Deal?> deal(String id) async {
    final r = await db.get(Entities.deals, id);
    return r == null || r.deleted ? null : Deal(r.data, local: r);
  }

  Future<Deal> saveDeal(Map<String, dynamic> fields, {String? id}) async {
    if (id == null && fields['branchId'] == null && fields['clientId'] is String) {
      final c = await db.get(Entities.clients, fields['clientId'] as String);
      final b = JsonModel.refId(c?.data['branchId']) ?? branch?.defaultId;
      if (b != null) fields = {...fields, 'branchId': b};
    }
    if (id == null) fields = {'stage': 'INQUIRY', ...fields};
    final r = id == null ? await store.create(Entities.deals, fields) : await store.update(Entities.deals, id, fields);
    return Deal(r.data, local: r);
  }

  Future<void> deleteDeal(String id) => store.delete(Entities.deals, id);

  /// Moves the deal; the server records the stage history when it syncs (shown locally meanwhile).
  Future<void> changeDealStage(String id, String stage, {required String? by, String? lostReason}) async {
    final d = await deal(id);
    if (d == null) return;
    await store.update(Entities.deals, id, {'stage': stage, 'lostReason': ?lostReason});
    // Local-only display of the new step (not part of the outbox mutation).
    final r = (await db.get(Entities.deals, id))!;
    final history = [...d.stageHistory, {'stage': stage, 'at': DateTime.now().toUtc().toIso8601String(), 'by': by}];
    await db.put(LocalRecord(entity: r.entity, uuid: r.uuid, serverId: r.serverId, version: r.version, data: {...r.data, 'stageHistory': history}, syncStatus: r.syncStatus));
    db.notify(Entities.deals);
  }

  static List<Map<String, dynamic>> _strip(List<Map<String, dynamic>> items, Set<String> keep) =>
      items.map((m) => {for (final e in m.entries) if (keep.contains(e.key) && e.value != null) e.key: e.value}).toList();
  static const _paymentKeys = {'_id', 'side', 'amount', 'date', 'method', 'reference', 'notes'};
  static const _payoutKeys = {'_id', 'userId', 'amount', 'date', 'status', 'notes'};

  Future<void> addDealPayment(String id, Map<String, dynamic> payment) async {
    final d = await deal(id);
    if (d == null) return;
    final next = [...d.payments, {'_id': const Uuid().v4(), ...payment}];
    await store.update(Entities.deals, id, {'payments': _strip(next, _paymentKeys)});
  }

  Future<void> removeDealPayment(String id, String paymentId) async {
    final d = await deal(id);
    if (d == null) return;
    await store.update(Entities.deals, id, {'payments': _strip(d.payments.where((p) => p['_id'] != paymentId).toList(), _paymentKeys)});
  }

  Future<void> addDealPayout(String id, Map<String, dynamic> payout) async {
    final d = await deal(id);
    if (d == null) return;
    final next = [...d.payouts, {'_id': const Uuid().v4(), 'status': 'PENDING', ...payout}];
    await store.update(Entities.deals, id, {'payouts': _strip(next.map((p) => {...p, 'userId': JsonModel.refId(p['userId'])}).toList(), _payoutKeys)});
  }

  Future<void> markDealPayoutPaid(String id, String payoutId) async {
    final d = await deal(id);
    if (d == null) return;
    final now = DateTime.now().toUtc().toIso8601String();
    final next = d.payouts.map((p) => p['_id'] == payoutId ? {...p, 'status': 'PAID', 'date': p['date'] ?? now} : p).toList();
    await store.update(Entities.deals, id, {'payouts': _strip(next.map((p) => {...p, 'userId': JsonModel.refId(p['userId'])}).toList(), _payoutKeys)});
  }

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

final crmRepositoryProvider = Provider<CrmRepository>((ref) => CrmRepository(ref.watch(databaseProvider), ref.watch(localStoreProvider), branch: ref.watch(branchScopeProvider)));

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

  // Administration (shared configuration: needs a connection)
  Future<Map<String, List<String>>> permissionTemplates() async {
    final r = await api.get<Map<String, dynamic>>('/meta/permissions');
    final t = Map<String, dynamic>.from((r['permissionTemplates'] as Map?) ?? const {});
    return {for (final e in t.entries) e.key: (e.value as List).cast<String>()};
  }

  Future<Map<String, List<String>>> permissionGroups() async {
    final r = await api.get<Map<String, dynamic>>('/meta/permissions');
    final g = Map<String, dynamic>.from((r['groups'] as Map?) ?? const {});
    return {for (final e in g.entries) e.key: (e.value as List).cast<String>()};
  }

  Future<Map<String, dynamic>> analytics(String range) => api.get<Map<String, dynamic>>('/dashboard/analytics', query: {'range': range});

  Future<({List<Map<String, dynamic>> items, Map<String, dynamic> meta})> auditLogs({int page = 1, String? entityType}) =>
      api.page('/audit-logs', query: {'page': page, 'limit': 30, 'entityType': ?entityType});

  Future<List<Map<String, dynamic>>> documentLibrary({String? entityType, String? category}) async =>
      (await api.page('/documents', query: {'limit': 100, 'entityType': ?entityType, 'category': ?category})).items;

  Future<List<Map<String, dynamic>>> agreementTemplatesOnline() async =>
      (await api.get<List<dynamic>>('/agreement-templates', query: {'includeArchived': 'true'})).cast<Map<String, dynamic>>();
  Future<void> createAgreementTemplate(Map<String, dynamic> body) => api.post('/agreement-templates', body);
  Future<void> updateAgreementTemplate(String id, Map<String, dynamic> body) => api.patch('/agreement-templates/$id', body);

  Future<List<Map<String, dynamic>>> financeCategories() async =>
      (await api.get<List<dynamic>>('/transaction-categories', query: {'includeArchived': 'true'})).cast<Map<String, dynamic>>();
  Future<void> createFinanceCategory(Map<String, dynamic> body) => api.post('/transaction-categories', body);
  Future<void> updateFinanceCategory(String id, Map<String, dynamic> body) => api.patch('/transaction-categories/$id', body);

  Future<void> createMember(Map<String, dynamic> body) => api.post('/members', body);
  Future<void> updateMember(String id, Map<String, dynamic> body) => api.patch('/members/$id', body);

  Future<List<Map<String, dynamic>>> clientCategories({bool includeArchived = false}) async =>
      (await api.get<List<dynamic>>('/client-categories', query: {if (includeArchived) 'includeArchived': 'true'})).cast<Map<String, dynamic>>();
  Future<void> createClientCategory(Map<String, dynamic> body) => api.post('/client-categories', body);
  Future<void> updateClientCategory(String id, Map<String, dynamic> body) => api.patch('/client-categories/$id', body);

  Future<Map<String, dynamic>> settings() => api.get<Map<String, dynamic>>('/settings');
  Future<void> updateSettings(Map<String, dynamic> body) => api.patch('/settings', body);

  // Brochures (made by the server; lang en/ur, never the minimum or expected price)
  Future<File> brochure(String serverId, {required String format, required String lang, bool hidePrice = false, String? agentId}) async {
    final r = await api.download('/properties/$serverId/brochure', query: {'format': format, 'lang': lang, 'hidePrice': '$hidePrice', 'agentId': ?agentId});
    final dir = await getTemporaryDirectory();
    final file = File(p.join(dir.path, r.fileName));
    await file.writeAsBytes(r.bytes, flush: true);
    return file;
  }

  Future<Map<String, dynamic>> brochureText(String serverId, {required String lang, bool hidePrice = false, String? agentId}) =>
      api.get<Map<String, dynamic>>('/properties/$serverId/brochure', query: {'format': 'text', 'lang': lang, 'hidePrice': '$hidePrice', 'agentId': ?agentId});

  // Agreements (text generation and PDFs are made by the server)
  Future<Map<String, dynamic>> renderAgreement(String serverId) => api.post<Map<String, dynamic>>('/agreements/$serverId/render', {});

  Future<File> agreementPdf(String serverId, {int? version}) async {
    final r = await api.download('/agreements/$serverId/pdf', query: {if (version != null) 'version': '$version'});
    final dir = await getTemporaryDirectory();
    final file = File(p.join(dir.path, r.fileName));
    await file.writeAsBytes(r.bytes, flush: true);
    return file;
  }

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

  /// Commission report (computed on the server; the last result stays visible offline).
  Future<({Map<String, dynamic> data, DateTime? cachedAt})> commissionReport({String groupBy = 'month', DateTime? from, DateTime? to}) => _cached(
        'cache.commissions.$groupBy.${from?.toIso8601String()}.${to?.toIso8601String()}',
        () => api.get<Map<String, dynamic>>('/reports/commissions', query: {'groupBy': groupBy, 'from': from?.toIso8601String(), 'to': to?.toIso8601String()}),
      );

  // Branches (management needs a connection; the list itself is synced to the phone)
  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> body) => api.post<Map<String, dynamic>>('/branches', body);
  Future<Map<String, dynamic>> updateBranch(String id, Map<String, dynamic> body) => api.patch<Map<String, dynamic>>('/branches/$id', body);
  Future<List<Map<String, dynamic>>> allBranches() async => (await api.get<List<dynamic>>('/branches', query: {'includeArchived': true})).cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> sessions() async => (await api.get<List<dynamic>>('/auth/sessions')).cast<Map<String, dynamic>>();
  Future<void> revokeSession(String id) => api.delete('/auth/sessions/$id');
}

final onlineRepositoryProvider = Provider<OnlineRepository>((ref) => OnlineRepository(ref.watch(apiClientProvider), ref.watch(databaseProvider)));
