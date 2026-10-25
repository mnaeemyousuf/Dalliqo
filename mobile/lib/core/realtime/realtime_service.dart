import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/env.dart';
import '../network/api_client.dart';
import '../storage/secure_store.dart';

/// Live updates between the father's and son's phones. Every server event is
/// a change notice; the app reacts by pulling a sync delta, so permissions
/// and tenant scoping always go through the normal API.
class RealtimeService extends ChangeNotifier {
  RealtimeService(this._store, this._api, {required this.onChange, required this.onNotification, required this.onSessionRevoked});

  final SecureStore _store;
  final ApiClient _api;
  final void Function(String event) onChange;
  final void Function(Map<String, dynamic> data) onNotification;
  final void Function() onSessionRevoked;

  io.Socket? _socket;
  bool connected = false;

  static const _events = [
    'client.created', 'client.updated', 'client.deleted',
    'property.created', 'property.updated', 'property.statusChanged', 'property.deleted',
    'owner.created', 'owner.updated',
    'match.created',
    'followup.created', 'followup.updated', 'followup.completed',
    'member.created', 'member.updated', 'business.updated',
  ];

  Future<void> connect() async {
    await disconnect();
    final token = await _store.accessToken;
    if (token == null) return;
    final s = io.io(
      Env.apiBaseUrl,
      io.OptionBuilder().setTransports(['websocket']).setAuth({'token': token}).disableAutoConnect().enableReconnection().build(),
    );
    s.onConnect((_) => _setConnected(true));
    s.onDisconnect((_) => _setConnected(false));
    s.onConnectError((err) async {
      _setConnected(false);
      final code = err is Map ? (err['data'] is Map ? (err['data'] as Map)['code'] : null) : null;
      if (code == 'TOKEN_EXPIRED' || code == 'INVALID_TOKEN') {
        final fresh = await _api.refresh();
        if (fresh != null) {
          s.auth = {'token': fresh};
          s.connect();
        }
      }
    });
    for (final e in _events) {
      s.on(e, (_) => onChange(e));
    }
    s.on('notification.created', (data) {
      onChange('notification.created');
      if (data is Map && data['data'] is Map) onNotification(Map<String, dynamic>.from(data['data'] as Map));
    });
    s.on('session.revoked', (_) => onSessionRevoked());
    _socket = s..connect();
  }

  void _setConnected(bool v) {
    connected = v;
    notifyListeners();
  }

  Future<void> disconnect() async {
    _socket?.dispose();
    _socket = null;
    _setConnected(false);
  }
}
