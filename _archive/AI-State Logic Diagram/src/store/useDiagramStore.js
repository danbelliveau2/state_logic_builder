/**
 * SDC State Logic Builder - Zustand Store
 * Central state management for all diagrams and UI state.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';

// Tiny ID generator (avoid nanoid async import issues)
let _id = Date.now();
const uid = () => `id_${(_id++).toString(36)}`;

// ─── Initial State ───────────────────────────────────────────────────────────

const defaultProject = {
  name: 'New Project',
  stateMachines: [],
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDiagramStore = create(
  persist(
    (set, get) => ({
      // ── Data ──────────────────────────────────────────────────────────────
      project: defaultProject,
      activeSmId: null,

      // ── UI State ──────────────────────────────────────────────────────────
      selectedNodeId: null,
      selectedEdgeId: null,

      // Modals
      showNewSmModal: false,
      showAddDeviceModal: false,
      showEditDeviceModal: false,
      editDeviceId: null,
      showActionModal: false,
      actionModalNodeId: null,
      actionModalActionId: null, // null = add new, string = edit existing
      showTransitionModal: false,
      transitionModalEdgeId: null,
      pendingEdgeData: null, // used when connecting two nodes

      // ── Computed helpers ──────────────────────────────────────────────────
      getActiveSm() {
        const { project, activeSmId } = get();
        return project.stateMachines.find(sm => sm.id === activeSmId) ?? null;
      },

      getSmById(id) {
        return get().project.stateMachines.find(sm => sm.id === id) ?? null;
      },

      getSelectedNode() {
        const sm = get().getActiveSm();
        const id = get().selectedNodeId;
        if (!sm || !id) return null;
        return sm.nodes.find(n => n.id === id) ?? null;
      },

      getSelectedEdge() {
        const sm = get().getActiveSm();
        const id = get().selectedEdgeId;
        if (!sm || !id) return null;
        return sm.edges.find(e => e.id === id) ?? null;
      },

      // ── Project actions ───────────────────────────────────────────────────
      setProjectName(name) {
        set(s => ({ project: { ...s.project, name } }));
      },

      loadProject(project) {
        set({
          project,
          activeSmId: project.stateMachines[0]?.id ?? null,
          selectedNodeId: null,
          selectedEdgeId: null,
        });
      },

      // ── State Machine actions ─────────────────────────────────────────────
      addStateMachine({ name, stationNumber, description }) {
        const id = uid();
        const sm = {
          id,
          name: name.replace(/[^a-zA-Z0-9_]/g, ''),
          displayName: name,
          stationNumber: Number(stationNumber) || 1,
          description: description ?? '',
          devices: [],
          nodes: [],
          edges: [],
        };
        set(s => ({
          project: { ...s.project, stateMachines: [...s.project.stateMachines, sm] },
          activeSmId: id,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return id;
      },

      updateStateMachine(id, updates) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === id ? { ...sm, ...updates } : sm
            ),
          },
        }));
      },

      deleteStateMachine(id) {
        set(s => {
          const remaining = s.project.stateMachines.filter(sm => sm.id !== id);
          return {
            project: { ...s.project, stateMachines: remaining },
            activeSmId: remaining[0]?.id ?? null,
            selectedNodeId: null,
            selectedEdgeId: null,
          };
        });
      },

      setActiveSm(id) {
        set({ activeSmId: id, selectedNodeId: null, selectedEdgeId: null });
      },

      // ── Device actions ────────────────────────────────────────────────────
      addDevice(smId, deviceData) {
        const device = { id: uid(), ...deviceData };
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, devices: [...sm.devices, device] }
                : sm
            ),
          },
        }));
        return device.id;
      },

      updateDevice(smId, deviceId, updates) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.map(d => d.id === deviceId ? { ...d, ...updates } : d) }
                : sm
            ),
          },
        }));
      },

      deleteDevice(smId, deviceId) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.filter(d => d.id !== deviceId) }
                : sm
            ),
          },
        }));
      },

      // ── Node (State Step) actions ─────────────────────────────────────────
      onNodesChange(smId, changes) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, nodes: applyNodeChanges(changes, sm.nodes) }
                : sm
            ),
          },
        }));
      },

      addNode(smId, options = {}) {
        const sm = get().project.stateMachines.find(s => s.id === smId);
        if (!sm) return null;
        const stepNum = sm.nodes.length;
        const id = uid();
        const node = {
          id,
          type: 'stateNode',
          position: options.position ?? {
            x: 300,
            y: 80 + stepNum * 200,
          },
          data: {
            stepNumber: stepNum,
            label: options.label ?? (stepNum === 0 ? 'Wait for Index Complete' : `Step ${stepNum}`),
            actions: [],
            isInitial: stepNum === 0,
          },
        };
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId ? { ...sm, nodes: [...sm.nodes, node] } : sm
            ),
          },
          selectedNodeId: id,
          selectedEdgeId: null,
        }));
        return id;
      },

      updateNodeData(smId, nodeId, dataUpdates) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, ...dataUpdates } }
                        : n
                    ),
                  }
                : sm
            ),
          },
        }));
      },

      deleteNode(smId, nodeId) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.filter(n => n.id !== nodeId),
                    edges: sm.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
                  }
                : sm
            ),
          },
          selectedNodeId: null,
        }));
      },

      renumberSteps(smId) {
        // Renumber all nodes by topological order (or current order)
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm => {
              if (sm.id !== smId) return sm;
              const nodes = sm.nodes.map((n, i) => ({
                ...n,
                data: { ...n.data, stepNumber: i, isInitial: i === 0 },
              }));
              return { ...sm, nodes };
            }),
          },
        }));
      },

      // ── Edge (Transition) actions ─────────────────────────────────────────
      onEdgesChange(smId, changes) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, edges: applyEdgeChanges(changes, sm.edges) }
                : sm
            ),
          },
        }));
      },

      addEdge(smId, connection, conditionData) {
        const id = uid();
        const label = conditionData?.label ?? 'Trigger';
        const edge = {
          id,
          source: connection.source,
          sourceHandle: connection.sourceHandle ?? null,
          target: connection.target,
          targetHandle: connection.targetHandle ?? null,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
          label,
          labelStyle: { fill: '#374151', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
          data: conditionData ?? { conditionType: 'trigger', label: 'Trigger' },
        };
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId ? { ...sm, edges: [...sm.edges, edge] } : sm
            ),
          },
        }));
        return id;
      },

      updateEdge(smId, edgeId, conditionData) {
        const label = conditionData?.label ?? 'Trigger';
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    edges: sm.edges.map(e =>
                      e.id === edgeId ? { ...e, label, data: conditionData } : e
                    ),
                  }
                : sm
            ),
          },
        }));
      },

      deleteEdge(smId, edgeId) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? { ...sm, edges: sm.edges.filter(e => e.id !== edgeId) }
                : sm
            ),
          },
          selectedEdgeId: null,
        }));
      },

      // ── Action (within a node) actions ────────────────────────────────────
      addAction(smId, nodeId, actionData) {
        const action = { id: uid(), ...actionData };
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, actions: [...n.data.actions, action] } }
                        : n
                    ),
                  }
                : sm
            ),
          },
        }));
        return action.id;
      },

      updateAction(smId, nodeId, actionId, updates) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              actions: n.data.actions.map(a =>
                                a.id === actionId ? { ...a, ...updates } : a
                              ),
                            },
                          }
                        : n
                    ),
                  }
                : sm
            ),
          },
        }));
      },

      deleteAction(smId, nodeId, actionId) {
        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, actions: n.data.actions.filter(a => a.id !== actionId) } }
                        : n
                    ),
                  }
                : sm
            ),
          },
        }));
      },

      // ── Selection ─────────────────────────────────────────────────────────
      setSelectedNode(id) {
        set({ selectedNodeId: id, selectedEdgeId: null });
      },

      setSelectedEdge(id) {
        set({ selectedEdgeId: id, selectedNodeId: null });
      },

      clearSelection() {
        set({ selectedNodeId: null, selectedEdgeId: null });
      },

      // ── Modal controls ────────────────────────────────────────────────────
      openNewSmModal() { set({ showNewSmModal: true }); },
      closeNewSmModal() { set({ showNewSmModal: false }); },

      openAddDeviceModal() { set({ showAddDeviceModal: true }); },
      closeAddDeviceModal() { set({ showAddDeviceModal: false }); },

      openEditDeviceModal(deviceId) { set({ showEditDeviceModal: true, editDeviceId: deviceId }); },
      closeEditDeviceModal() { set({ showEditDeviceModal: false, editDeviceId: null }); },

      openActionModal(nodeId, actionId = null) {
        set({ showActionModal: true, actionModalNodeId: nodeId, actionModalActionId: actionId });
      },
      closeActionModal() {
        set({ showActionModal: false, actionModalNodeId: null, actionModalActionId: null });
      },

      openTransitionModal(edgeId) {
        set({ showTransitionModal: true, transitionModalEdgeId: edgeId });
      },
      closeTransitionModal() {
        set({ showTransitionModal: false, transitionModalEdgeId: null, pendingEdgeData: null });
      },

      setPendingEdge(data) {
        set({ pendingEdgeData: data });
      },
    }),
    {
      name: 'sdc-state-logic-v1',
      // Only persist the project data, not UI state
      partialize: (state) => ({ project: state.project, activeSmId: state.activeSmId }),
    }
  )
);
