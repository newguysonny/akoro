/** Transport + Hostel module pages (mgmt schema). */
import { useState, useEffect, useCallback } from 'react';
import { Bus, Route, MapPin, BedDouble, DoorClosed, Users } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};

/* ═══ TRANSPORT ═══ */
export function TransportDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/transport`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.vehicles, label: 'Vehicles', icon: Bus, ti: 'ti-bus', c: BLUE, to: '/mgmt/manage-vehicles' },
    { n: s.activeVehicles, label: 'Active Vehicles', icon: Bus, ti: 'ti-bus', c: GREEN, to: '/mgmt/manage-vehicles' },
    { n: s.routes, label: 'Routes', icon: Route, ti: 'ti-route', c: PURPLE, to: '/mgmt/manage-routes' },
    { n: s.locationReports, label: 'Location Reports', icon: MapPin, ti: 'ti-map-pin', c: C.brand, to: '/mgmt/vehicle-tracking' },
  ] : [];
  return <PageLayout title="Transport Dashboard" subtitle="Fleet & routes at a glance"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function ManageVehiclesPage() {
  const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'maintenance', label: 'Maintenance' }, { value: 'retired', label: 'Retired' }];
  return <ResourcePage title="Manage Vehicles" subtitle="The school fleet" resource="vehicles"
    columns={[
      { key: 'plate_no', label: 'Plate No' }, { key: 'model', label: 'Model' }, { key: 'capacity', label: 'Capacity' },
      { key: 'driver_name', label: 'Driver' }, { key: 'driver_phone', label: 'Driver Phone' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { active: GREEN, maintenance: C.brand, retired: C.muted2 }) },
    ]}
    fields={[
      { key: 'plate_no', label: 'Plate Number', required: true },
      { key: 'model', label: 'Model', placeholder: 'Toyota Coaster' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', default: 'active', options: STATUSES },
      { key: 'driver_name', label: 'Driver Name' },
      { key: 'driver_phone', label: 'Driver Phone' },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="Add Vehicle" />;
}

export function ManageRoutesPage() {
  return <ResourcePage title="Manage Routes" subtitle="Pickup & drop-off routes" resource="transport-routes"
    columns={[
      { key: 'name', label: 'Route' }, { key: 'start_point', label: 'From' }, { key: 'end_point', label: 'To' },
      { key: 'fare', label: 'Fare / Term', render: (r) => naira(r.fare) }, { key: 'vehicle_name', label: 'Vehicle' },
    ]}
    fields={[
      { key: 'name', label: 'Route Name', required: true },
      { key: 'vehicle_id', label: 'Vehicle', type: 'select', optionsFrom: { resource: 'vehicles', labelKey: 'plate_no' } },
      { key: 'start_point', label: 'Start Point' },
      { key: 'end_point', label: 'End Point' },
      { key: 'fare', label: 'Fare per Term (₦)', type: 'number' },
    ]} createLabel="New Route" />;
}

export function VehicleTrackingPage() {
  const [fleet, setFleet] = useState(null);
  const [vehicleId, setVehicleId] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`${BASE}/transport/latest-locations`).then((r) => setFleet(r.data || [])).catch(() => setFleet([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const report = async () => {
    if (!vehicleId || !location.trim()) return showToast('Pick a vehicle and enter its location');
    setBusy(true);
    try {
      await apiPost(`${BASE}/vehicle-locations`, { vehicle_id: vehicleId, location: location.trim(), note: note || '' });
      showToast('Position reported ✓'); setLocation(''); setNote(''); load();
    } catch (e) { showToast(e.message || 'Could not report'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Live Vehicle Tracking" subtitle="Latest reported position per vehicle">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="">— vehicle —</option>
          {(fleet || []).map((v) => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
        </select>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Current location…" style={{ ...inputStyle, width: 240 }} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, width: 200 }} />
        <button onClick={report} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 9, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-map-pin" size={13} />} Report Position
        </button>
      </div>

      {fleet && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {fleet.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font, background: C.surface, border: `1.5px dashed ${C.border}`, borderRadius: 14 }}>No vehicles yet — add one under Manage Vehicles.</div>
          ) : fleet.map((v) => (
            <div key={v.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', fontFamily: C.font }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Ico ti="ti-bus" size={16} color={BLUE} />
                  <b style={{ fontSize: 13.5, color: C.ink }}>{v.plate_no}</b>
                </div>
                {pill(v.status, { active: GREEN, maintenance: C.brand, retired: C.muted2 })}
              </div>
              <p style={{ fontSize: 12, color: C.muted2, margin: '0 0 8px' }}>{v.model || '—'} · {v.driver_name || 'No driver'}</p>
              {v.last ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.bg, borderRadius: 9, padding: '9px 11px' }}>
                  <Ico ti="ti-map-pin" size={13} color={C.brand} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{v.last.location}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: C.muted2 }}>{new Date(v.last.reported_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{v.last.note ? ` · ${v.last.note}` : ''}</span>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: C.muted2, margin: 0 }}>No position reported yet.</p>
              )}
            </div>
          ))}
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ═══ HOSTEL ═══ */
export function HostelDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/hostel`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.hostels, label: 'Hostels', icon: BedDouble, ti: 'ti-bed', c: BLUE, to: '/mgmt/manage-hostels' },
    { n: s.rooms, label: 'Rooms', icon: DoorClosed, ti: 'ti-door', c: PURPLE, to: '/mgmt/manage-rooms' },
    { n: s.capacity, label: 'Total Bed Spaces', icon: Users, ti: 'ti-users', c: C.brand },
    { n: s.allocated, label: 'Students Allocated', icon: Users, ti: 'ti-users', c: GREEN, to: '/mgmt/student-allocation' },
    { n: s.roomTypes, label: 'Room Types', icon: DoorClosed, ti: 'ti-door', c: BLUE, to: '/mgmt/room-types' },
  ] : [];
  return <PageLayout title="Hostel Dashboard" subtitle="Boarding facilities at a glance"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function StudentAllocationPage() {
  const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'vacated', label: 'Vacated' }];
  return <ResourcePage title="Student Allocation" subtitle="Who sleeps where" resource="hostel-allocations"
    columns={[
      { key: 'student_name', label: 'Student' }, { key: 'room_name', label: 'Room' },
      { key: 'allocated_on', label: 'Allocated' }, { key: 'vacated_on', label: 'Vacated' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { active: GREEN, vacated: C.muted2 }) },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: { resource: 'students', labelFn: (r) => `${r.first_name} ${r.last_name} (${r.admission_no})` } },
      { key: 'room_id', label: 'Room', type: 'select', required: true, optionsFrom: { resource: 'hostel-rooms', labelFn: (r) => `${r.hostel_name || ''} — ${r.room_no}` } },
      { key: 'allocated_on', label: 'Allocated On', type: 'date' },
      { key: 'vacated_on', label: 'Vacated On', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'active', options: STATUSES },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="Allocate Student" />;
}

export function ManageRoomsPage() {
  return <ResourcePage title="Manage Rooms" subtitle="Rooms per hostel" resource="hostel-rooms"
    columns={[
      { key: 'hostel_name', label: 'Hostel' }, { key: 'room_no', label: 'Room' },
      { key: 'room_type_name', label: 'Type' }, { key: 'capacity', label: 'Capacity' },
    ]}
    fields={[
      { key: 'hostel_id', label: 'Hostel', type: 'select', optionsFrom: { resource: 'hostels' } },
      { key: 'room_type_id', label: 'Room Type', type: 'select', optionsFrom: { resource: 'room-types' } },
      { key: 'room_no', label: 'Room Number', required: true },
      { key: 'capacity', label: 'Capacity', type: 'number', default: 4 },
    ]} listFilters={[{ key: 'hostel_id', label: 'Hostel', optionsFrom: { resource: 'hostels' } }]} createLabel="New Room" />;
}

export function RoomTypesPage() {
  return <ResourcePage title="Room Types" subtitle="Room categories & pricing" resource="room-types"
    columns={[
      { key: 'name', label: 'Type' }, { key: 'capacity', label: 'Capacity' },
      { key: 'cost_per_term', label: 'Cost / Term', render: (r) => naira(r.cost_per_term) },
    ]}
    fields={[
      { key: 'name', label: 'Type Name', required: true, placeholder: 'Standard (4-bed)' },
      { key: 'capacity', label: 'Capacity', type: 'number', default: 4 },
      { key: 'cost_per_term', label: 'Cost per Term (₦)', type: 'number' },
    ]} createLabel="New Type" />;
}

export function ManageHostelsPage() {
  const TYPES = [{ value: 'boys', label: 'Boys' }, { value: 'girls', label: 'Girls' }, { value: 'mixed', label: 'Mixed' }];
  return <ResourcePage title="Manage Hostels" subtitle="Boarding houses" resource="hostels"
    columns={[
      { key: 'name', label: 'Hostel' },
      { key: 'hostel_type', label: 'Type', render: (r) => pill(r.hostel_type, { boys: BLUE, girls: PURPLE, mixed: GREEN }) },
      { key: 'warden_name', label: 'Warden' }, { key: 'warden_phone', label: 'Warden Phone' },
    ]}
    fields={[
      { key: 'name', label: 'Hostel Name', required: true },
      { key: 'hostel_type', label: 'Type', type: 'select', default: 'mixed', options: TYPES },
      { key: 'warden_name', label: 'Warden Name' },
      { key: 'warden_phone', label: 'Warden Phone' },
    ]} createLabel="New Hostel" />;
}
