import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';

/// Search a place, tap to drop a pin, or use the phone's location.
/// Pops with a ({double lat, double lng}) record.
class LocationPickerScreen extends StatefulWidget {
  const LocationPickerScreen({super.key, this.initial});
  final ({double lat, double lng})? initial;
  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  static const _karachi = LatLng(24.8607, 67.0011);
  GoogleMapController? _map;
  LatLng? _pin;
  final _search = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) _pin = LatLng(widget.initial!.lat, widget.initial!.lng);
  }

  Future<void> _move(LatLng p) async {
    setState(() => _pin = p);
    await _map?.animateCamera(CameraUpdate.newLatLngZoom(p, 16));
  }

  Future<void> _find() async {
    if (_search.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      final results = await Geocoding().locationFromAddress('${_search.text.trim()}, Pakistan');
      if (results.isNotEmpty) await _move(LatLng(results.first.latitude, results.first.longitude));
    } catch (_) {
      if (mounted) showMessage(context, context.t('common.noResults'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _myLocation() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return;
    final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
    await _move(LatLng(pos.latitude, pos.longitude));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(context.t('mobile.map.pickLocation')),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(60),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _find(),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: context.t('mobile.map.searchPlace'),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _busy ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))) : null,
                ),
              ),
            ),
          ),
        ),
        body: Stack(children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _pin ?? _karachi, zoom: _pin == null ? 11 : 16),
            onMapCreated: (c) => _map = c,
            onTap: (p) => setState(() => _pin = p),
            myLocationButtonEnabled: false,
            markers: {if (_pin != null) Marker(markerId: const MarkerId('pin'), position: _pin!)},
          ),
          if (_pin == null)
            Positioned(
              top: 12,
              left: 12,
              right: 12,
              child: Card(child: Padding(padding: const EdgeInsets.all(10), child: Text(context.t('mobile.map.tapToDrop'), textAlign: TextAlign.center))),
            ),
        ]),
        floatingActionButton: FloatingActionButton.small(heroTag: 'loc', onPressed: _myLocation, child: const Icon(Icons.my_location)),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: AppButton(
              label: context.t('mobile.map.useThis'),
              expand: true,
              onPressed: _pin == null ? null : () => Navigator.of(context).pop<({double lat, double lng})>((lat: _pin!.latitude, lng: _pin!.longitude)),
            ),
          ),
        ),
      );
}
