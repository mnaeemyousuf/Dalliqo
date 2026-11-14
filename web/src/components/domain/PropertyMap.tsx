import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Property } from '@/api/types';
import { formatPkr } from '@/lib/format';

/**
 * Map of listings with coordinates (OpenStreetMap tiles; the tile URL can be swapped for any
 * provider through VITE_MAP_TILES). Loaded on demand so the main bundle stays small.
 */
const TILES = import.meta.env.VITE_MAP_TILES ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

const STATUS_COLOR: Record<string, string> = { AVAILABLE: '#10b981', RESERVED: '#f59e0b', UNDER_NEGOTIATION: '#8b5cf6', SOLD: '#3b82f6', RENTED: '#8b5cf6' };

function pin(color: string) {
  return L.divIcon({
    className: '',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
    html: `<svg width="26" height="34" viewBox="0 0 26 34"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 21 13 21s13-11.2 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`,
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [map, points]);
  return null;
}

export default function PropertyMap({ properties }: { properties: Property[] }) {
  const { t } = useTranslation();
  const located = useMemo(() => properties.filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number'), [properties]);
  const points = useMemo(() => located.map((p) => [p.latitude!, p.longitude!] as [number, number]), [located]);
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-line shadow-card">
        <MapContainer center={[24.86, 67.01]} zoom={11} scrollWheelZoom className="h-[34rem] w-full" style={{ zIndex: 0 }}>
          <TileLayer url={TILES} attribution={ATTRIBUTION} />
          <FitBounds points={points} />
          {located.map((p) => (
            <Marker key={p._id} position={[p.latitude!, p.longitude!]} icon={pin(STATUS_COLOR[p.status] ?? '#64748b')}>
              <Popup>
                <div className="min-w-[12rem] space-y-1 text-sm">
                  {p.coverThumbnailUrl && <img src={p.coverThumbnailUrl} alt="" className="mb-1 h-24 w-full rounded object-cover" />}
                  <Link to={`/properties/${p._id}`} className="font-bold text-brand-600">{p.propertyId}</Link>
                  <p>{t(`enums.propertyType.${p.propertyType}`)} · {[p.block, p.society].filter(Boolean).join(', ')}</p>
                  <p className="font-semibold">{formatPkr(p.askingPrice)}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-muted">{t('property.map.summary', { shown: located.length, total: properties.length })}{located.length < properties.length ? ` ${t('property.map.missing')}` : ''}</p>
    </div>
  );
}
