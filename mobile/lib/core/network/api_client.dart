import 'dart:async';

import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/secure_store.dart';

/// API error carrying the server's stable error code (see shared/src/errorCodes.ts).
class ApiException implements Exception {
  ApiException(this.code, this.message, {this.status, this.details});

  final String code;
  final String message;
  final int? status;
  final Object? details;

  bool get isNetwork => code == 'NETWORK';

  /// Field → message map for VALIDATION_ERROR responses.
  Map<String, String> get fieldErrors {
    final d = details;
    if (code != 'VALIDATION_ERROR' || d is! List) return const {};
    final out = <String, String>{};
    for (final e in d.whereType<Map>()) {
      out[(e['path'] as String? ?? '').split('.').first] = e['message'] as String? ?? '';
    }
    return out;
  }

  @override
  String toString() => 'ApiException($code, $message)';
}

/// Dio wrapper. Mobile sends `X-Client-Type: mobile`, so refresh tokens come
/// back in the body and are kept in the OS keystore. Refreshes are
/// single-flight: concurrent 401s wait for one rotation, because the server
/// treats a replayed refresh token as theft and revokes the session.
class ApiClient {
  ApiClient(this._store, {Dio? dio, this.onSessionLost})
      : dio = dio ??
            Dio(BaseOptions(
              baseUrl: Env.api,
              connectTimeout: const Duration(seconds: 15),
              receiveTimeout: const Duration(seconds: 60),
              headers: {'X-Client-Type': 'mobile'},
            )) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio dio;
  final SecureStore _store;

  /// Called when the session can't be recovered (revoked, password changed, …).
  void Function()? onSessionLost;

  Future<String?>? _refreshing;

  static const _retryable = {'TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHENTICATED'};

  Future<void> _onRequest(RequestOptions o, RequestInterceptorHandler h) async {
    final token = await _store.accessToken;
    if (token != null && o.headers['Authorization'] == null) o.headers['Authorization'] = 'Bearer $token';
    h.next(o);
  }

  Future<void> _onError(DioException e, ErrorInterceptorHandler h) async {
    final res = e.response;
    final code = res?.data is Map ? (res!.data as Map)['code'] as String? : null;
    final path = e.requestOptions.path;
    final isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/refresh') || path.startsWith('/auth/register');
    if (res?.statusCode == 401 && !isAuthCall && e.requestOptions.extra['retried'] != true && _retryable.contains(code)) {
      final token = await refresh();
      if (token != null) {
        final retry = e.requestOptions
          ..headers['Authorization'] = 'Bearer $token'
          ..extra['retried'] = true;
        try {
          return h.resolve(await dio.fetch(retry));
        } on DioException catch (err) {
          return h.next(err);
        }
      }
    }
    if (res?.statusCode == 401 && !isAuthCall) onSessionLost?.call();
    h.next(e);
  }

  /// Rotates the refresh token. Returns the new access token, or null if the session is gone.
  Future<String?> refresh() {
    return _refreshing ??= () async {
      try {
        final rt = await _store.refreshToken;
        if (rt == null) return null;
        final r = await Dio(BaseOptions(baseUrl: Env.api, headers: {'X-Client-Type': 'mobile'}))
            .post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': rt});
        final d = r.data!['data'] as Map<String, dynamic>;
        await _store.saveTokens(access: d['accessToken'] as String, refresh: d['refreshToken'] as String);
        return d['accessToken'] as String;
      } on DioException catch (e) {
        // Only a definite rejection ends the session; network trouble just means "try later".
        if (e.response?.statusCode == 401) {
          await _store.clearTokens();
          onSessionLost?.call();
        }
        return null;
      } finally {
        _refreshing = null;
      }
    }();
  }

  static ApiException toApiException(Object e) {
    if (e is ApiException) return e;
    if (e is DioException) {
      final data = e.response?.data;
      if (e.response == null) return ApiException('NETWORK', e.message ?? 'Network error');
      if (data is Map) {
        return ApiException(
          data['code'] as String? ?? 'INTERNAL_ERROR',
          data['message'] as String? ?? 'Request failed',
          status: e.response?.statusCode,
          details: data['details'],
        );
      }
      return ApiException('INTERNAL_ERROR', 'Request failed', status: e.response?.statusCode);
    }
    return ApiException('INTERNAL_ERROR', e.toString());
  }

  Future<T> _wrap<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final r = await call();
      return (r.data as Map<String, dynamic>)['data'] as T;
    } catch (e) {
      throw toApiException(e);
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _wrap<T>(() => dio.get(path, queryParameters: _clean(query)));
  Future<T> post<T>(String path, [Object? body]) => _wrap<T>(() => dio.post(path, data: body ?? const <String, dynamic>{}));
  Future<T> patch<T>(String path, Object body) => _wrap<T>(() => dio.patch(path, data: body));
  Future<T> delete<T>(String path) => _wrap<T>(() => dio.delete(path));

  /// List endpoints: items plus pagination meta.
  Future<({List<Map<String, dynamic>> items, Map<String, dynamic> meta})> page(String path, {Map<String, dynamic>? query}) async {
    try {
      final r = await dio.get(path, queryParameters: _clean(query));
      final body = r.data as Map<String, dynamic>;
      return (
        items: (body['data'] as List).cast<Map<String, dynamic>>(),
        meta: (body['meta'] as Map<String, dynamic>?) ?? const <String, dynamic>{},
      );
    } catch (e) {
      throw toApiException(e);
    }
  }

  Future<T> upload<T>(String path, FormData form, {void Function(double progress)? onProgress}) => _wrap<T>(
        () => dio.post(
          path,
          data: form,
          options: Options(sendTimeout: const Duration(minutes: 10), receiveTimeout: const Duration(minutes: 10)),
          onSendProgress: (sent, total) => onProgress?.call(total > 0 ? sent / total : 0),
        ),
      );

  /// Binary download (exports).
  Future<({List<int> bytes, String fileName})> download(String path, {Map<String, dynamic>? query}) async {
    try {
      final r = await dio.get<List<int>>(path, queryParameters: _clean(query), options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 5)));
      final cd = r.headers.value('content-disposition') ?? '';
      final name = RegExp(r'filename="([^"]+)"').firstMatch(cd)?.group(1) ?? 'export';
      return (bytes: r.data!, fileName: name);
    } catch (e) {
      throw toApiException(e);
    }
  }

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) =>
      q == null ? null : (Map.of(q)..removeWhere((_, v) => v == null || (v is String && v.isEmpty)));
}
