/**
 * DeviceSidebar - Left panel showing the device library for the active state machine.
 * Allows dragging device actions onto the canvas or adding new devices.
 */

import { useState } from 'react';
import { DEVICE_TYPES, DEVICE_CATEGORIES } from '../lib/deviceTypes.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

function DeviceItem({ device, smId }) {
  const store = useDiagramStore();
  const typeInfo = DEVICE_TYPES[device.type];

  function handleDragStart(e) {
    e.dataTransfer.setData('application/state-node', 'true');
    e.dataTransfer.setData('application/state-node-label', `${device.displayName}`);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      className="device-item"
      draggable
      onDragStart={handleDragStart}
      style={{ '--device-color': typeInfo?.color ?? '#9ca3af' }}
    >
      <span className="device-item__icon">{typeInfo?.icon ?? '?'}</span>
      <div className="device-item__info">
        <span className="device-item__name">{device.displayName}</span>
        <span className="device-item__type">{typeInfo?.label ?? device.type}</span>
      </div>
      <div className="device-item__actions">
        <button
          className="icon-btn icon-btn--sm"
          title="Edit device"
          onClick={() => store.openEditDeviceModal(device.id)}
        >✏</button>
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          title="Delete device"
          onClick={() => {
            if (confirm(`Delete device "${device.displayName}"?`)) {
              store.deleteDevice(smId, device.id);
            }
          }}
        >✕</button>
      </div>
    </div>
  );
}

function NewStateButton({ smId }) {
  const store = useDiagramStore();

  function handleDragStart(e) {
    e.dataTransfer.setData('application/state-node', 'true');
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <button
      className="sidebar-new-state-btn"
      draggable
      onDragStart={handleDragStart}
      onClick={() => store.addNode(smId)}
      title="Drag to canvas or click to add a new state step"
    >
      <span>⊞</span>
      <span>Add State Step</span>
    </button>
  );
}

export function DeviceSidebar() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const [collapsed, setCollapsed] = useState(false);

  if (!sm) return null;

  const devices = sm.devices ?? [];

  // Group by category
  const grouped = {};
  for (const [cat, types] of Object.entries(DEVICE_CATEGORIES)) {
    const devs = devices.filter(d => types.includes(d.type));
    if (devs.length > 0) grouped[cat] = devs;
  }

  return (
    <aside className={`device-sidebar${collapsed ? ' device-sidebar--collapsed' : ''}`}>
      <div className="device-sidebar__header">
        {!collapsed && <span className="device-sidebar__title">Devices</span>}
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
          {/* Add State Step drag target */}
          <div className="device-sidebar__section">
            <NewStateButton smId={sm.id} />
          </div>

          {/* Device library */}
          <div className="device-sidebar__section-header">
            <span>Device Library</span>
            <button
              className="btn btn--xs btn--ghost"
              onClick={store.openAddDeviceModal}
              title="Add a new device to this state machine"
            >
              + Add
            </button>
          </div>

          {/* Scrollable device list */}
          <div className="device-sidebar__scroll">
            {devices.length === 0 && (
              <div className="device-sidebar__empty">
                <p>No devices defined yet.</p>
                <button className="btn btn--sm btn--secondary" onClick={store.openAddDeviceModal}>
                  + Add Device
                </button>
              </div>
            )}

            {Object.entries(grouped).map(([cat, devs]) => (
              <div key={cat} className="device-group">
                <div className="device-group__label">{cat}</div>
                {devs.map(d => (
                  <DeviceItem key={d.id} device={d} smId={sm.id} />
                ))}
              </div>
            ))}

            {/* Ungrouped devices */}
            {devices
              .filter(d => !Object.values(DEVICE_CATEGORIES).flat().includes(d.type))
              .map(d => <DeviceItem key={d.id} device={d} smId={sm.id} />)}
          </div>
        </>
      )}
    </aside>
  );
}
