/**
 * DeviceSidebar - Left panel showing the device library for the active state machine.
 * Allows dragging device actions onto the canvas or adding new devices.
 * Subjects can be drag-reordered within the sidebar.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { DEVICE_TYPES, DEVICE_CATEGORIES } from '../lib/deviceTypes.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DeviceIcon } from './DeviceIcons.jsx';
import { SignalModal } from './modals/SignalModal.jsx';

// ── Part Tracking Section ──────────────────────────────────────────────────────

function PartTrackingSection() {
  const store = useDiagramStore();
  const fields = store.project?.partTracking?.fields ?? [];
  const [collapsed, setCollapsed] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef(null);
  const newInputRef = useRef(null);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  useEffect(() => {
    if (addingNew && newInputRef.current) newInputRef.current.focus();
  }, [addingNew]);

  function startEdit(field) {
    setEditingId(field.id);
    setEditValue(field.name);
  }

  function commitEdit() {
    if (editingId && editValue.trim()) {
      const cleanName = editValue.trim().replace(/[^a-zA-Z0-9_]/g, '');
      if (cleanName) {
        store.updateTrackingField(editingId, { name: cleanName });
      }
    }
    setEditingId(null);
    setEditValue('');
  }

  function handleAdd() {
    setAddingNew(true);
    setNewName('');
  }

  function commitAdd() {
    const cleanName = newName.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (cleanName) {
      store.addTrackingField({ name: cleanName });
    }
    setAddingNew(false);
    setNewName('');
  }

  return (
    <div className="part-tracking-section">
      <div className="device-sidebar__section-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
        <span>{collapsed ? '▸' : '▾'} Part Tracking</span>
        {!collapsed && (
          <button
            className="btn btn--xs btn--ghost"
            onClick={(e) => { e.stopPropagation(); handleAdd(); }}
            title="Add a new tracking field"
          >
            + Add
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="part-tracking-section__list">
          {fields.length === 0 && !addingNew && (
            <div className="device-sidebar__empty" style={{ padding: '6px 10px', fontSize: 11 }}>
              <p>No tracking fields yet.</p>
            </div>
          )}

          {fields.map(f => (
            <div key={f.id} className="pt-field-row">
              {editingId === f.id ? (
                <input
                  ref={inputRef}
                  className="pt-field-row__input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <span
                  className="pt-field-row__name"
                  onClick={() => startEdit(f)}
                  title="Click to rename"
                >{f.name}</span>
              )}
              <span className="pt-field-row__type">{f.dataType === 'boolean' ? 'BOOL' : f.dataType}</span>
              <button
                className="icon-btn icon-btn--sm icon-btn--danger"
                title="Delete field"
                onClick={() => {
                  if (confirm(`Delete tracking field "${f.name}"?`)) {
                    store.deleteTrackingField(f.id);
                  }
                }}
              >✕</button>
            </div>
          ))}

          {addingNew && (
            <div className="pt-field-row">
              <input
                ref={newInputRef}
                className="pt-field-row__input"
                placeholder="FieldName"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onBlur={commitAdd}
                onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAddingNew(false); }}
              />
              <span className="pt-field-row__type">BOOL</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Signals Section ────────────────────────────────────────────────────────────

const SIGNAL_TYPE_BADGES = {
  position: { label: 'POS', color: '#f59e0b', bg: '#78350f', textColor: '#fcd34d' },
  state:     { label: 'STATE', color: '#0072B5', bg: '#1e3a5f', textColor: '#93c5fd' },
  partTracking: { label: 'PT', color: '#5a9a48', bg: '#1a3a1a', textColor: '#86efac' },
  condition: { label: 'COND', color: '#6b7280', bg: '#1f2937', textColor: '#d1d5db' },
};

function SignalsSection() {
  const store = useDiagramStore();
  const signals = store.project?.signals ?? [];
  const [collapsed, setCollapsed] = useState(true);
  const [editingSignal, setEditingSignal] = useState(null); // null=closed, undefined=new, object=edit
  const [showModal, setShowModal] = useState(false);

  function openNew() { setEditingSignal(undefined); setShowModal(true); }
  function openEdit(sig) { setEditingSignal(sig); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditingSignal(null); }

  return (
    <>
      <div className="part-tracking-section">
        <div className="device-sidebar__section-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
          <span>{collapsed ? '▸' : '▾'} Signals</span>
          {!collapsed && (
            <button
              className="btn btn--xs btn--ghost"
              onClick={(e) => { e.stopPropagation(); openNew(); }}
              title="Add a new signal"
            >
              + Add
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="part-tracking-section__list">
            {signals.length === 0 && (
              <div className="device-sidebar__empty" style={{ padding: '6px 10px', fontSize: 11 }}>
                <p>No signals defined yet.</p>
              </div>
            )}
            {signals.map(sig => {
              const badge = SIGNAL_TYPE_BADGES[sig.type] ?? SIGNAL_TYPE_BADGES.condition;
              return (
                <div key={sig.id} className="pt-field-row">
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                    color: badge.textColor, background: badge.bg, border: `1px solid ${badge.color}`,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {badge.label}
                  </span>
                  <span className="pt-field-row__name" title={sig.description || sig.name}>{sig.name}</span>
                  <button
                    className="icon-btn icon-btn--sm"
                    title="Edit signal"
                    onClick={() => openEdit(sig)}
                  >✏</button>
                  <button
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    title="Delete signal"
                    onClick={() => {
                      if (confirm(`Delete signal "${sig.name}"?`)) {
                        store.deleteSignal(sig.id);
                      }
                    }}
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SignalModal
        isOpen={showModal}
        signal={editingSignal}
        onClose={closeModal}
      />
    </>
  );
}

function DeviceItem({ device, smId, onReorderDragStart, onReorderDragOver, onReorderDrop, onReorderDragEnd, isDragOver, dragPosition }) {
  const store = useDiagramStore();
  const typeInfo = DEVICE_TYPES[device.type];

  function handleDragStart(e) {
    // If starting from the drag handle, do reorder
    if (e.target.classList.contains('device-item__drag-handle')) {
      onReorderDragStart?.(e, device.id);
      return;
    }
    // Otherwise, drag to canvas
    e.dataTransfer.setData('application/state-node', 'true');
    e.dataTransfer.setData('application/state-node-label', `${device.displayName}`);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      className={`device-item${isDragOver && dragPosition === 'above' ? ' device-item--drop-above' : ''}${isDragOver && dragPosition === 'below' ? ' device-item--drop-below' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragOver={(e) => onReorderDragOver?.(e, device.id)}
      onDrop={(e) => onReorderDrop?.(e, device.id)}
      onClick={() => { if (!device._autoVision) store.openEditDeviceModal(device.id); }}
      style={{ '--device-color': device._autoVision ? '#b8a020' : (typeInfo?.color ?? '#9ca3af'), cursor: device._autoVision ? 'default' : 'pointer' }}
    >
      <span
        className="device-item__drag-handle"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onReorderDragStart?.(e, device.id);
        }}
        onDragEnd={onReorderDragEnd}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
      >⠿</span>
      <span className="device-item__icon"><DeviceIcon type={device.type} size={18} /></span>
      <div className="device-item__info">
        <span className="device-item__name" title={device.displayName}>{device.displayName}</span>
        <span className="device-item__type">{typeInfo?.label ?? device.type}</span>
      </div>
      <div className="device-item__actions">
        {device._autoVision ? (
          <span style={{ fontSize: 9, color: '#9ca3af', fontStyle: 'italic', padding: '0 4px' }}>auto</span>
        ) : (
          <>
            <button
              className="icon-btn icon-btn--sm"
              title="Duplicate device"
              onClick={(e) => {
                e.stopPropagation();
                const newId = store.duplicateDevice(smId, device.id);
                if (newId) store.openEditDeviceModal(newId);
              }}
              style={{ color: '#6b7280' }}
            >⧉</button>
            <button
              className="icon-btn icon-btn--sm icon-btn--danger"
              title="Delete device"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete subject "${device.displayName}"?`)) {
                  store.deleteDevice(smId, device.id);
                }
              }}
            >✕</button>
          </>
        )}
      </div>
    </div>
  );
}

export function DeviceSidebar() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(220);
  const resizing = useRef(false);

  // Drag-to-reorder state
  const [dragDeviceId, setDragDeviceId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragPosition, setDragPosition] = useState(null); // 'above' | 'below'

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = width;
    function onMove(ev) {
      const newW = Math.min(Math.max(startW + (ev.clientX - startX), 160), 500);
      setWidth(newW);
    }
    function onUp() {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  // Reorder drag handlers
  function handleReorderDragStart(e, deviceId) {
    setDragDeviceId(deviceId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/device-reorder', deviceId);
  }

  function handleReorderDragOver(e, targetId) {
    if (!dragDeviceId || dragDeviceId === targetId) return;
    // Only handle reorder drags (not canvas drags)
    if (!e.dataTransfer.types.includes('application/device-reorder')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragOverId(targetId);
    setDragPosition(e.clientY < midY ? 'above' : 'below');
  }

  function handleReorderDrop(e, targetId) {
    e.preventDefault();
    if (!dragDeviceId || !sm || dragDeviceId === targetId) return;
    const insertAfter = dragPosition === 'below';
    store.reorderDevices(sm.id, dragDeviceId, targetId, insertAfter);
    setDragDeviceId(null);
    setDragOverId(null);
    setDragPosition(null);
  }

  function handleReorderDragEnd() {
    setDragDeviceId(null);
    setDragOverId(null);
    setDragPosition(null);
  }

  if (!sm) return null;

  const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

  // Group by category
  const grouped = {};
  for (const [cat, types] of Object.entries(DEVICE_CATEGORIES)) {
    const devs = devices.filter(d => types.includes(d.type));
    if (devs.length > 0) grouped[cat] = devs;
  }

  return (
    <aside
      className={`device-sidebar${collapsed ? ' device-sidebar--collapsed' : ''}`}
      style={collapsed ? undefined : { width, minWidth: width }}
    >
      <div className="device-sidebar__header">
        {!collapsed && <span className="device-sidebar__title">Subjects</span>}
        <button
          className="icon-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Subject library */}
          <div className="device-sidebar__section-header">
            <span>Subject Library</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn--xs btn--ghost"
                onClick={() => { store.refreshSubjects(sm.id); }}
                title="Refresh subjects — sync vision params and propagate device changes to nodes"
              >
                ↻
              </button>
              <button
                className="btn btn--xs btn--ghost"
                onClick={store.openAddDeviceModal}
                title="Add a new subject to this state machine"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Scrollable subject list — gets priority space */}
          <div className="device-sidebar__scroll">
            {devices.length === 0 && (
              <div className="device-sidebar__empty">
                <p>No subjects defined yet.</p>
                <button className="btn btn--sm btn--secondary" onClick={store.openAddDeviceModal}>
                  + Add Subject
                </button>
              </div>
            )}

            {Object.entries(grouped).map(([cat, devs]) => (
              <div key={cat} className="device-group">
                <div className="device-group__label">{cat}</div>
                {devs.map(d => (
                  <DeviceItem
                    key={d.id}
                    device={d}
                    smId={sm.id}
                    onReorderDragStart={handleReorderDragStart}
                    onReorderDragOver={handleReorderDragOver}
                    onReorderDrop={handleReorderDrop}
                    onReorderDragEnd={handleReorderDragEnd}
                    isDragOver={dragOverId === d.id}
                    dragPosition={dragOverId === d.id ? dragPosition : null}
                  />
                ))}
              </div>
            ))}

            {/* Ungrouped devices */}
            {devices
              .filter(d => !Object.values(DEVICE_CATEGORIES).flat().includes(d.type))
              .map(d => (
                <DeviceItem
                  key={d.id}
                  device={d}
                  smId={sm.id}
                  onReorderDragStart={handleReorderDragStart}
                  onReorderDragOver={handleReorderDragOver}
                  onReorderDrop={handleReorderDrop}
                  onReorderDragEnd={handleReorderDragEnd}
                  isDragOver={dragOverId === d.id}
                  dragPosition={dragOverId === d.id ? dragPosition : null}
                />
              ))}
          </div>

          {/* Bottom panel — PT & Signals, compact, constrained height */}
          <div className="device-sidebar__bottom-panel">
            <PartTrackingSection />
            <SignalsSection />
          </div>
        </>
      )}
      {/* Drag handle to resize sidebar */}
      {!collapsed && (
        <div className="device-sidebar__resize" onMouseDown={handleMouseDown} />
      )}
    </aside>
  );
}
