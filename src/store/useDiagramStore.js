/**
 * SDC State Logic Builder - Zustand Store
 * Central state management for all diagrams and UI state.
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import * as projectApi from '../lib/projectApi.js';

// Tiny ID generator (avoid nanoid async import issues)
let _id = Date.now();
const uid = () => `id_${(_id++).toString(36)}`;

// ─── Initial State ───────────────────────────────────────────────────────────

// ─── Default Standards Profile (SDC) ────────────────────────────────────────
const defaultStandardsProfile = {
  name: 'SDC Standard',
  // Tag naming
  tagCase: 'PascalCase',           // PascalCase, camelCase, snake_case
  inputPrefix: 'i_',               // Sensor/digital input tags
  outputPrefix: 'q_',              // Solenoid/drive output tags
  parameterPrefix: 'p_',           // Public parameters (HMI/recipe)
  globalPrefix: 'g_',              // Controller-scoped global tags
  localPrefix: '',                 // Program-local tags (no prefix)
  // Program naming
  stationPrefix: 'S',              // e.g. S01, S02
  processPrefix: 'P',              // e.g. P01 for non-indexing
  programNameSeparator: '_',       // S01_PartLoad
  // Routine naming
  routineNames: {
    main: 'R00_Main',
    inputs: 'R01_Inputs',
    stateTransitions: 'R02_StateTransitions',
    stateLogicValves: 'R03_StateLogicValves',
    stateLogicServo: 'R04_StateLogicServo',
    alarms: 'R20_Alarms',
  },
  // Tag patterns (use {name} placeholder)
  sensorExtendPattern: 'i_{name}Ext',
  sensorRetractPattern: 'i_{name}Ret',
  outputExtendPattern: 'q_Ext{name}',
  outputRetractPattern: 'q_Ret{name}',
  delayTimerPattern: '{name}{suffix}Delay',       // suffix = Ext/Ret/Engage etc.
  // AOI references
  stateEngineAOI: 'State_Engine_128Max',
  alarmHandlerAOI: 'ProgramAlarmHandler',
  clockAOI: 'CPU_TimeDate_wJulian',
  cycleTimeAOI: 'MovingAverage',
  // Alarm message format
  alarmMessageFormat: '{station} {stationName}: {message}',
  // Network device prefixes
  networkPrefixes: {
    camera: 'cam',
    robot: 'rob',
    servoDrive: 'sd',
    valveBank: 'vb',
    ioBlock: 'io',
    vfd: 'fd',
    genericDevice: 'gd',
  },
  // Axis naming
  axisPrefix: 'a',                 // a01_Indexer
  // Supervisor states
  supervisorStates: ['SafetyStopped', 'ManualMode', 'AutoIdle', 'AutoRunning', 'CycleStopping', 'CycleStopped'],
  // Cycle start delay (ms)
  cycleStartDelay: 2000,
  // Stuck-in-run timeout (ms)
  stuckInRunTimeout: 10000,
  // Consecutive failures default
  consecutiveFailuresDefault: 3,
};

// ─── Default Machine Config ─────────────────────────────────────────────────
const defaultMachineConfig = {
  machineType: 'indexing',          // indexing, linear, robotCell, testInspect, custom
  machineName: '',
  customerName: '',
  projectNumber: '',
  targetCycleTime: 0,              // seconds
  stationCount: 0,
  nestCount: 0,                    // for indexing machines
  stations: [],                    // [{ id, number, name, type, smIds[], bypass, lockout }]
  // station type: assembly, verify, label, robot, conveyor, test, custom
};

const defaultProject = {
  name: 'New Project',
  stateMachines: [],
  partTracking: { fields: [] },
  signals: [],
  recipes: [],           // [{ id, name, description, isDefault, customSequence, sequenceVariantId }]
  recipeOverrides: {},    // { [recipeId]: { positions, timers, speeds, skippedNodes, customSMs } }
  sequenceVariants: [],   // [{ id, name, stateMachines: [...] }]  — named alternative sequences
  standardsProfile: defaultStandardsProfile,
  machineConfig: defaultMachineConfig,
};

// ─── Recipe-aware SM helpers ─────────────────────────────────────────────────
// These are defined outside the store so every action can reference them.

/** Return the correct SM array (base or custom/variant) for the current recipe context. */
function _getSmArray(state) {
  const { activeRecipeId, project } = state;
  if (!activeRecipeId) return project.stateMachines ?? [];
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);
  if (!recipe) return project.stateMachines ?? [];

  // Named sequence variant takes precedence
  if (recipe.sequenceVariantId) {
    const variant = (project.sequenceVariants ?? []).find(v => v.id === recipe.sequenceVariantId);
    if (variant) return variant.stateMachines ?? [];
  }

  // Legacy: per-recipe custom SMs
  if (recipe.customSequence) {
    const customSMs = project.recipeOverrides?.[activeRecipeId]?.customSMs;
    return customSMs ?? project.stateMachines ?? [];
  }

  return project.stateMachines ?? [];
}

/** Apply an updater function to the correct SM array and return the new project. */
function _updateProject(state, smsUpdater) {
  const { activeRecipeId, project } = state;
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);

  // Named sequence variant
  if (recipe?.sequenceVariantId) {
    const variants = [...(project.sequenceVariants ?? [])];
    const vi = variants.findIndex(v => v.id === recipe.sequenceVariantId);
    if (vi >= 0) {
      variants[vi] = { ...variants[vi], stateMachines: smsUpdater(variants[vi].stateMachines ?? []) };
      return { ...project, sequenceVariants: variants };
    }
  }

  // Legacy per-recipe custom SMs
  const isCustom = recipe?.customSequence && project.recipeOverrides?.[activeRecipeId]?.customSMs;
  if (isCustom) {
    const overrides = { ...project.recipeOverrides };
    const recipeOv = { ...overrides[activeRecipeId] };
    recipeOv.customSMs = smsUpdater(recipeOv.customSMs);
    overrides[activeRecipeId] = recipeOv;
    return { ...project, recipeOverrides: overrides };
  }

  return { ...project, stateMachines: smsUpdater(project.stateMachines ?? []) };
}

/**
 * Generate a unique PLC tag name for a device across all SMs.
 * e.g. "HeadOpener" → "HeadOpener2" → "HeadOpener3"
 */
function _uniqueDeviceName(baseName, allSMs) {
  const allNames = new Set();
  for (const sm of allSMs) {
    for (const dev of (sm.devices ?? [])) {
      allNames.add(dev.name);
    }
  }
  if (!allNames.has(baseName)) return baseName;
  let n = 2;
  while (allNames.has(`${baseName}${n}`)) n++;
  return `${baseName}${n}`;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDiagramStore = create(
  subscribeWithSelector(
  persist(
    (set, get) => ({
      // ── Data ──────────────────────────────────────────────────────────────
      project: defaultProject,
      activeSmId: null,
      currentFilename: null,   // filename of the active project on the server
      serverAvailable: false,  // true when the project API server is detected

      // ── Recipe state ──────────────────────────────────────────────────────
      activeRecipeId: null,
      showRecipeManager: false,

      // ── UI State ──────────────────────────────────────────────────────────
      selectedNodeId: null,
      selectedEdgeId: null,

      // Modals
      showNewSmModal: false,
      showProjectManager: false,
      showAddDeviceModal: false,
      showEditDeviceModal: false,
      editDeviceId: null,
      showActionModal: false,
      actionModalNodeId: null,
      actionModalActionId: null, // null = add new, string = edit existing
      showTransitionModal: false,
      transitionModalEdgeId: null,
      pendingEdgeData: null, // used when connecting two nodes
      openPickerOnNodeId: null, // signals a node to auto-open its inline picker
      _closePickerSignal: 0,   // increment to close all inline pickers
      _isDrawingConnection: false, // true while user is dragging/clicking waypoints
      _drawingWaypoints: [],       // waypoints placed by clicking during connection
      _drawingSource: null,        // { nodeId, handleId } — source of manual draw connection
      _drawPathMode: false,        // toolbar toggle: treat handle-drag as shift-drag (manual path)

      // ── Computed helpers ──────────────────────────────────────────────────
      getActiveSm() {
        return _getSmArray(get()).find(sm => sm.id === get().activeSmId) ?? null;
      },

      getSmById(id) {
        return _getSmArray(get()).find(sm => sm.id === id) ?? null;
      },

      getSelectedNode() {
        const sm = get().getActiveSm();
        const id = get().selectedNodeId;
        if (!sm || !id) return null;
        return (sm.nodes ?? []).find(n => n.id === id) ?? null;
      },

      getSelectedEdge() {
        const sm = get().getActiveSm();
        const id = get().selectedEdgeId;
        if (!sm || !id) return null;
        return (sm.edges ?? []).find(e => e.id === id) ?? null;
      },

      // ── Undo / Redo ────────────────────────────────────────────────────────
      _past: [],     // snapshots before each mutation
      _future: [],   // snapshots after undo (cleared on new mutations)

      /** Capture current project state before a mutation. */
      _pushHistory() {
        const { project, _past } = get();
        const snapshot = JSON.stringify(project);
        const newPast = [..._past, snapshot];
        if (newPast.length > 50) newPast.shift();
        set({ _past: newPast, _future: [] });
      },

      undo() {
        const { _past, _future, project } = get();
        if (_past.length === 0) return;
        const newPast = [..._past];
        const previous = newPast.pop();
        const currentSnapshot = JSON.stringify(project);
        set({
          project: JSON.parse(previous),
          _past: newPast,
          _future: [currentSnapshot, ..._future],
        });
      },

      redo() {
        const { _past, _future, project } = get();
        if (_future.length === 0) return;
        const newFuture = [..._future];
        const next = newFuture.shift();
        const currentSnapshot = JSON.stringify(project);
        set({
          project: JSON.parse(next),
          _past: [..._past, currentSnapshot],
          _future: newFuture,
        });
      },

      // ── Project actions ───────────────────────────────────────────────────
      setProjectName(name) {
        get()._pushHistory();
        set(s => ({ project: { ...s.project, name } }));
      },

      loadProject(project) {
        // Ensure partTracking exists for older projects
        if (!project.partTracking) project.partTracking = { fields: [] };
        // Migrate referencePositions → signals (position type)
        if (!project.signals) {
          project.signals = [];
          // Convert legacy referencePositions to signals with type='position'
          for (const rp of (project.referencePositions ?? [])) {
            project.signals.push({
              id: rp.id,
              name: rp.name,
              description: rp.description ?? '',
              type: 'position',
              axes: (rp.axes ?? []).map(a => ({
                smId: a.smId,
                deviceId: a.axisDeviceId,
                deviceName: a.axisDeviceId,
                positionName: a.positionName,
                tolerance: a.tolerance,
              })),
            });
          }
          // Convert legacy smOutputs from each SM → signals with type='state'
          for (const sm of (project.stateMachines ?? [])) {
            for (const o of (sm.smOutputs ?? [])) {
              project.signals.push({
                id: o.id,
                name: o.name,
                description: o.description ?? '',
                type: 'state',
                smId: sm.id,
                stateNodeId: o.activeNodeId ?? null,
                stateName: o.name,
              });
            }
          }
        }
        // Remove legacy referencePositions field
        delete project.referencePositions;
        // Ensure recipe fields exist for older projects
        if (!project.recipes) project.recipes = [];
        if (!project.recipeOverrides) project.recipeOverrides = {};
        // Ensure standardsProfile and machineConfig exist for older projects
        if (!project.standardsProfile) project.standardsProfile = { ...defaultStandardsProfile };
        if (!project.machineConfig) project.machineConfig = { ...defaultMachineConfig };
        // Migration: remove legacy _autoVision Parameter devices (replaced by Part Tracking)
        for (const sm of (project.stateMachines ?? [])) {
          if (sm.devices) {
            sm.devices = sm.devices.filter(d => !d._autoVision);
          }
          // Keep smOutputs on SM for backward compat rendering but also ensure it exists
          if (!sm.smOutputs) sm.smOutputs = [];
          // Migration: convert old latch-pattern (triggerNodeId/clearNodeId/autoClear) to new OTE model (activeNodeId)
          sm.smOutputs = sm.smOutputs.map(o => {
            if ('triggerNodeId' in o || 'clearNodeId' in o || 'autoClear' in o) {
              const { triggerNodeId, clearNodeId, autoClear, ...rest } = o;
              return { ...rest, activeNodeId: triggerNodeId ?? o.activeNodeId ?? null };
            }
            return o;
          });
        }
        // Migration: ensure all ServoAxis devices have Slow + Fast speed profiles
        for (const sm of (project.stateMachines ?? [])) {
          for (const dev of (sm.devices ?? [])) {
            if (dev.type === 'ServoAxis') {
              if (!dev.speedProfiles) dev.speedProfiles = [];
              if (!dev.speedProfiles.find(p => p.name === 'Slow')) {
                dev.speedProfiles.push({ name: 'Slow', speed: 100, accel: 1000, decel: 1000 });
              }
              if (!dev.speedProfiles.find(p => p.name === 'Fast')) {
                dev.speedProfiles.push({ name: 'Fast', speed: 2500, accel: 25000, decel: 25000 });
              }
            }
          }
        }
        set({
          project,
          activeSmId: project.stateMachines[0]?.id ?? null,
          selectedNodeId: null,
          selectedEdgeId: null,
          _past: [],
          _future: [],
        });
      },

      // ── Standards Profile actions ───────────────────────────────────────────
      updateStandardsProfile(updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            standardsProfile: { ...(s.project.standardsProfile ?? defaultStandardsProfile), ...updates },
          },
        }));
      },

      resetStandardsProfile() {
        get()._pushHistory();
        set(s => ({
          project: { ...s.project, standardsProfile: { ...defaultStandardsProfile } },
        }));
      },

      // ── Machine Config actions ──────────────────────────────────────────────
      updateMachineConfig(updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            machineConfig: { ...(s.project.machineConfig ?? defaultMachineConfig), ...updates },
          },
        }));
      },

      setMachineStationCount(count) {
        get()._pushHistory();
        set(s => {
          const mc = { ...(s.project.machineConfig ?? defaultMachineConfig) };
          const existing = mc.stations ?? [];
          const stations = [];
          for (let i = 0; i < count; i++) {
            if (existing[i]) {
              stations.push(existing[i]);
            } else {
              stations.push({
                id: uid(),
                number: i + 1,
                name: `Station ${i + 1}`,
                type: 'load',
                smIds: [],
                bypass: false,
                lockout: false,
              });
            }
          }
          mc.stations = stations;
          mc.stationCount = count;
          return { project: { ...s.project, machineConfig: mc } };
        });
      },

      updateStation(stationId, updates) {
        get()._pushHistory();
        set(s => {
          const mc = { ...(s.project.machineConfig ?? defaultMachineConfig) };
          mc.stations = (mc.stations ?? []).map(st =>
            st.id === stationId ? { ...st, ...updates } : st
          );
          return { project: { ...s.project, machineConfig: mc } };
        });
      },

      linkSmToStation(stationId, smId) {
        get()._pushHistory();
        set(s => {
          const mc = { ...(s.project.machineConfig ?? defaultMachineConfig) };
          mc.stations = (mc.stations ?? []).map(st => {
            if (st.id !== stationId) return st;
            const smIds = [...(st.smIds ?? [])];
            if (!smIds.includes(smId)) smIds.push(smId);
            return { ...st, smIds };
          });
          return { project: { ...s.project, machineConfig: mc } };
        });
      },

      unlinkSmFromStation(stationId, smId) {
        get()._pushHistory();
        set(s => {
          const mc = { ...(s.project.machineConfig ?? defaultMachineConfig) };
          mc.stations = (mc.stations ?? []).map(st => {
            if (st.id !== stationId) return st;
            return { ...st, smIds: (st.smIds ?? []).filter(id => id !== smId) };
          });
          return { project: { ...s.project, machineConfig: mc } };
        });
      },

      // ── UI: Project Setup view ──────────────────────────────────────────────
      activeView: 'canvas',  // 'canvas' | 'projectSetup'
      setActiveView(view) { set({ activeView: view }); },

      // ── State Machine actions ─────────────────────────────────────────────
      addStateMachine({ name, stationNumber, description }) {
        get()._pushHistory();
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
          smOutputs: [],
        };
        set(s => ({
          project: { ...s.project, stateMachines: [...s.project.stateMachines, sm] },
          activeSmId: id,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return id;
      },

      /**
       * Auto-generate a Dial_Indexer SM for indexing dial machines.
       * Creates: servo device, 3 states (Wait All Ready → Index → Cycle Complete),
       * and an "AllStationsReady" condition signal.
       */
      autoGenerateIndexerSM() {
        const state = get();
        const mc = state.project?.machineConfig ?? {};
        const nestCount = mc.nestCount ?? mc.stations?.length ?? 12;

        // Don't duplicate — check if an indexer SM already exists
        const existing = _getSmArray(state).find(sm =>
          sm.name === 'Dial_Indexer' || sm.name === 'DialIndexer' || sm.name === 'Indexer'
        );
        if (existing) return existing.id;

        get()._pushHistory();

        // 1. Create the SM
        const smId = uid();
        const machineType = mc.machineType ?? 'indexing';
        const smName = machineType === 'indexing' ? 'Dial_Indexer' : 'Indexer';
        const sm = {
          id: smId,
          name: smName,
          displayName: smName,
          stationNumber: 99,
          description: 'Auto-generated indexer — waits for all stations ready, then indexes.',
          devices: [],
          nodes: [],
          edges: [],
          smOutputs: [],
        };

        // 2. Create servo device with Index position pre-configured
        const deviceId = uid();
        const indexAngle = Math.round((360 / nestCount) * 10000) / 10000;
        const device = {
          id: deviceId,
          type: 'ServoAxis',
          displayName: smName,
          name: smName.replace(/[^a-zA-Z0-9]/g, ''),
          tagStem: smName.replace(/[^a-zA-Z0-9]/g, ''),
          axisNumber: 1,
          motionType: machineType === 'indexing' ? 'rotary' : 'linear',
          positions: [{
            name: 'Index',
            type: 'index',
            moveType: 'Idx',
            defaultValue: indexAngle,
            heads: nestCount,
            isHome: false,
            isRecipe: false,
          }],
          speedProfiles: [
            { name: 'Slow', speed: 100, accel: 1000, decel: 1000 },
            { name: 'Fast', speed: 2500, accel: 25000, decel: 25000 },
          ],
          sensorArrangement: 'none',
        };
        sm.devices.push(device);

        // 3. Create nodes: DecisionNode (Wait All Ready) → StateNode (Index) → StateNode (Cycle Complete)
        const nodeX = 400;
        const decisionNodeId = uid();
        const indexNodeId = uid();
        const completeNodeId = uid();

        // Decision node: waits on AllStationsReady signal (single exit = "Ready")
        sm.nodes.push({
          id: decisionNodeId,
          type: 'decisionNode',
          position: { x: nodeX, y: 100 },
          data: {
            label: 'Wait All Ready',
            decisionType: 'signal',
            signalName: 'AllStationsReady',
            signalSource: 'All Stations',
            signalType: 'condition',
            exitCount: 1,
            exit1Label: 'Ready',
            autoOpenPopup: false,
            conditions: [{
              signalName: 'AllStationsReady',
              signalSource: 'All Stations',
              signalType: 'condition',
              sensorState: 'on',
            }],
            conditionLogic: 'AND',
          },
        });

        // Index state: servo index action
        sm.nodes.push({
          id: indexNodeId,
          type: 'stateNode',
          position: { x: nodeX, y: 340 },
          data: {
            stepNumber: 1,
            label: 'Index',
            actions: [{
              id: uid(),
              deviceId: deviceId,
              operation: 'ServoIndex',
              positionName: 'Index',
              indexAngle: indexAngle,
              indexStations: 1,
            }],
            isInitial: false,
          },
        });

        // Cycle Complete
        sm.nodes.push({
          id: completeNodeId,
          type: 'stateNode',
          position: { x: nodeX, y: 580 },
          data: {
            stepNumber: 2,
            label: 'Cycle Complete',
            actions: [],
            isInitial: false,
            isComplete: true,
          },
        });

        // 4. Create edges (no loop-back — state engine handles that)
        // Decision → Index (single exit, green "Ready")
        sm.edges.push({
          id: uid(),
          source: decisionNodeId,
          sourceHandle: 'exit-single',
          target: indexNodeId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: 'Ready',
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: 'Ready', isDecisionExit: true, exitColor: 'pass', outcomeLabel: 'Ready' },
        });

        // Index → Cycle Complete (servo at target)
        sm.edges.push({
          id: uid(),
          source: indexNodeId,
          sourceHandle: null,
          target: completeNodeId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
          label: 'Index Complete',
          labelStyle: { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace' },
          labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
          data: { conditionType: 'servoAtTarget', label: 'Index Complete', deviceId: deviceId },
        });

        // 5. Add SM to project (don't change activeSmId — keep user on their current SM)
        set(s => ({
          project: {
            ...s.project,
            stateMachines: [...s.project.stateMachines, sm],
          },
        }));

        // 6. Create "AllStationsReady" condition signal if it doesn't exist
        const signals = get().project?.signals ?? [];
        if (!signals.find(s => s.name === 'AllStationsReady')) {
          get().addSignal({
            name: 'AllStationsReady',
            description: 'TRUE when all station SMs are at Cycle Complete — used by Dial Indexer.',
            type: 'condition',
            builtIn: true,
          });
        }

        return smId;
      },

      updateStateMachine(id, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === id ? { ...sm, ...updates } : sm
            )),
        }));
      },

      deleteStateMachine(id) {
        get()._pushHistory();
        set(s => {
          const remaining = s.project.stateMachines.filter(sm => sm.id !== id);
          // Clean up station smIds references
          const mc = s.project.machineConfig;
          let updatedMc = mc;
          if (mc?.stations) {
            const updatedStations = mc.stations.map(st => {
              const smIds = st.smIds ?? [];
              if (smIds.includes(id)) {
                return { ...st, smIds: smIds.filter(sid => sid !== id) };
              }
              return st;
            });
            updatedMc = { ...mc, stations: updatedStations };
          }
          return {
            project: { ...s.project, stateMachines: remaining, machineConfig: updatedMc },
            activeSmId: remaining[0]?.id ?? null,
            selectedNodeId: null,
            selectedEdgeId: null,
          };
        });
      },

      duplicateStateMachine(sourceId) {
        get()._pushHistory();
        const source = get().project.stateMachines.find(sm => sm.id === sourceId);
        if (!source) return null;

        // Build ID remapping tables
        const deviceIdMap = {};
        const nodeIdMap = {};

        // Clone devices with new IDs and unique PLC tag names
        const allSMs = _getSmArray(get());
        // Track names we've already assigned in this batch to avoid self-collision
        const usedNames = new Set();
        for (const sm of allSMs) {
          for (const d of (sm.devices ?? [])) usedNames.add(d.name);
        }
        const newDevices = (source.devices ?? []).map(dev => {
          const newId = uid();
          deviceIdMap[dev.id] = newId;
          // Find a unique name (skip names already used globally + in this batch)
          let newName = dev.name;
          if (usedNames.has(newName)) {
            let n = 2;
            while (usedNames.has(`${dev.name}${n}`)) n++;
            newName = `${dev.name}${n}`;
          }
          usedNames.add(newName);
          const newDisplayName = newName !== dev.name
            ? (dev.displayName ?? dev.name).replace(/\s*\(Copy.*?\)\s*$/, '') + ` (${newName})`
            : dev.displayName;
          return { ...JSON.parse(JSON.stringify(dev)), id: newId, name: newName, displayName: newDisplayName ?? dev.displayName };
        });

        // Clone nodes with new IDs, remap deviceId in actions
        const newNodes = (source.nodes ?? []).map(node => {
          const newId = uid();
          nodeIdMap[node.id] = newId;
          const newData = JSON.parse(JSON.stringify(node.data ?? {}));
          // Remap action deviceIds
          if (newData.actions) {
            newData.actions = newData.actions.map(a => ({
              ...a,
              deviceId: a.deviceId === '_tracking' ? '_tracking' : (deviceIdMap[a.deviceId] ?? a.deviceId),
            }));
          }
          return { ...node, id: newId, data: newData, selected: false };
        });

        // Clone edges with new IDs, remap source/target + data.deviceId
        const newEdges = (source.edges ?? []).map(edge => {
          const newEdge = JSON.parse(JSON.stringify(edge));
          newEdge.id = uid();
          newEdge.source = nodeIdMap[edge.source] ?? edge.source;
          newEdge.target = nodeIdMap[edge.target] ?? edge.target;
          if (newEdge.data?.deviceId) {
            newEdge.data.deviceId = deviceIdMap[newEdge.data.deviceId] ?? newEdge.data.deviceId;
          }
          newEdge.selected = false;
          return newEdge;
        });

        // Remap _sourceNodeId on devices (CheckResults auto-verify)
        for (const dev of newDevices) {
          if (dev._sourceNodeId) {
            dev._sourceNodeId = nodeIdMap[dev._sourceNodeId] ?? dev._sourceNodeId;
          }
        }

        // Clone smOutputs with new IDs, remap activeNodeId
        const newOutputs = (source.smOutputs ?? []).map(out => ({
          ...JSON.parse(JSON.stringify(out)),
          id: uid(),
          activeNodeId: out.activeNodeId ? (nodeIdMap[out.activeNodeId] ?? out.activeNodeId) : null,
        }));

        // Find next station number
        const allNums = get().project.stateMachines.map(sm => sm.stationNumber ?? 0);
        const nextNum = Math.max(...allNums, 0) + 1;

        const newId = uid();
        const newSm = {
          id: newId,
          name: (source.name + 'Copy').replace(/[^a-zA-Z0-9_]/g, ''),
          displayName: (source.displayName ?? source.name) + ' (Copy)',
          stationNumber: nextNum,
          description: source.description ?? '',
          devices: newDevices,
          nodes: newNodes,
          edges: newEdges,
          smOutputs: newOutputs,
        };

        set(s => ({
          project: { ...s.project, stateMachines: [...s.project.stateMachines, newSm] },
          activeSmId: newId,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return newId;
      },

      /**
       * Replace a target SM's contents (nodes/edges/devices/smOutputs) with a clone
       * of the source SM's contents. Keeps the target's id, name, displayName,
       * stationNumber, and description so references from other SMs remain valid.
       */
      overwriteStateMachineFrom(targetSmId, sourceSmId) {
        if (!targetSmId || !sourceSmId || targetSmId === sourceSmId) return false;
        get()._pushHistory();
        const state = get();
        const target = state.project.stateMachines.find(sm => sm.id === targetSmId);
        const source = state.project.stateMachines.find(sm => sm.id === sourceSmId);
        if (!target || !source) return false;

        const deviceIdMap = {};
        const nodeIdMap = {};
        const allSMs = _getSmArray(state);

        // Names used by other SMs (exclude target — its device names get replaced)
        const usedNames = new Set();
        for (const sm of allSMs) {
          if (sm.id === targetSmId) continue;
          for (const d of (sm.devices ?? [])) usedNames.add(d.name);
        }

        const newDevices = (source.devices ?? []).map(dev => {
          const newId = uid();
          deviceIdMap[dev.id] = newId;
          let newName = dev.name;
          if (usedNames.has(newName)) {
            let n = 2;
            while (usedNames.has(`${dev.name}${n}`)) n++;
            newName = `${dev.name}${n}`;
          }
          usedNames.add(newName);
          return { ...JSON.parse(JSON.stringify(dev)), id: newId, name: newName, displayName: dev.displayName ?? dev.name };
        });

        const newNodes = (source.nodes ?? []).map(node => {
          const newId = uid();
          nodeIdMap[node.id] = newId;
          const newData = JSON.parse(JSON.stringify(node.data ?? {}));
          if (newData.actions) {
            newData.actions = newData.actions.map(a => ({
              ...a,
              deviceId: a.deviceId === '_tracking' ? '_tracking' : (deviceIdMap[a.deviceId] ?? a.deviceId),
            }));
          }
          return { ...node, id: newId, data: newData, selected: false };
        });

        const newEdges = (source.edges ?? []).map(edge => {
          const ne = JSON.parse(JSON.stringify(edge));
          ne.id = uid();
          ne.source = nodeIdMap[edge.source] ?? edge.source;
          ne.target = nodeIdMap[edge.target] ?? edge.target;
          if (ne.data?.deviceId) ne.data.deviceId = deviceIdMap[ne.data.deviceId] ?? ne.data.deviceId;
          ne.selected = false;
          return ne;
        });

        for (const dev of newDevices) {
          if (dev._sourceNodeId) dev._sourceNodeId = nodeIdMap[dev._sourceNodeId] ?? dev._sourceNodeId;
        }

        const newOutputs = (source.smOutputs ?? []).map(out => ({
          ...JSON.parse(JSON.stringify(out)),
          id: uid(),
          activeNodeId: out.activeNodeId ? (nodeIdMap[out.activeNodeId] ?? out.activeNodeId) : null,
        }));

        set(s => ({
          project: {
            ...s.project,
            stateMachines: s.project.stateMachines.map(sm =>
              sm.id === targetSmId
                ? { ...sm, devices: newDevices, nodes: newNodes, edges: newEdges, smOutputs: newOutputs }
                : sm
            ),
          },
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return true;
      },

      /**
       * Batch-generate state machines from an array of station generation configs.
       * Each config: { stationId, stationNumber, stationName, stationType, copyFromSmId,
       *                axes: [{ label, type }] | [], verifyType: string | null }
       */
      batchGenerateStateMachines(configs) {
        if (!configs || configs.length === 0) return [];
        get()._pushHistory();

        const allSMs = _getSmArray(get());
        const createdSMs = [];
        const newSmIds = []; // [{ stationId, smId }]

        for (const cfg of configs) {
          const safeName = (cfg.stationName ?? 'Station').replace(/[^a-zA-Z0-9_]/g, '');
          const displayName = cfg.stationName ?? 'Station';

          // ── Copy mode ───────────────────────────────────────────────────────
          if (cfg.copyFromSmId) {
            const source = [...allSMs, ...createdSMs].find(sm => sm.id === cfg.copyFromSmId);
            if (!source) continue;

            // Reuse duplicateStateMachine ID-remapping logic inline
            const deviceIdMap = {};
            const nodeIdMap = {};
            const usedNames = new Set();
            for (const sm of [...allSMs, ...createdSMs]) {
              for (const d of (sm.devices ?? [])) usedNames.add(d.name);
            }

            const newDevices = (source.devices ?? []).map(dev => {
              const newId = uid();
              deviceIdMap[dev.id] = newId;
              let newName = dev.name;
              if (usedNames.has(newName)) {
                let n = 2;
                while (usedNames.has(`${dev.name}${n}`)) n++;
                newName = `${dev.name}${n}`;
              }
              usedNames.add(newName);
              return { ...JSON.parse(JSON.stringify(dev)), id: newId, name: newName, displayName: dev.displayName ?? dev.name };
            });

            const newNodes = (source.nodes ?? []).map(node => {
              const newId = uid();
              nodeIdMap[node.id] = newId;
              const newData = JSON.parse(JSON.stringify(node.data ?? {}));
              if (newData.actions) {
                newData.actions = newData.actions.map(a => ({
                  ...a,
                  deviceId: a.deviceId === '_tracking' ? '_tracking' : (deviceIdMap[a.deviceId] ?? a.deviceId),
                }));
              }
              return { ...node, id: newId, data: newData, selected: false };
            });

            const newEdges = (source.edges ?? []).map(edge => {
              const ne = JSON.parse(JSON.stringify(edge));
              ne.id = uid();
              ne.source = nodeIdMap[edge.source] ?? edge.source;
              ne.target = nodeIdMap[edge.target] ?? edge.target;
              if (ne.data?.deviceId) ne.data.deviceId = deviceIdMap[ne.data.deviceId] ?? ne.data.deviceId;
              ne.selected = false;
              return ne;
            });

            for (const dev of newDevices) {
              if (dev._sourceNodeId) dev._sourceNodeId = nodeIdMap[dev._sourceNodeId] ?? dev._sourceNodeId;
            }

            const newOutputs = (source.smOutputs ?? []).map(out => ({
              ...JSON.parse(JSON.stringify(out)),
              id: uid(),
              activeNodeId: out.activeNodeId ? (nodeIdMap[out.activeNodeId] ?? out.activeNodeId) : null,
            }));

            const smId = uid();
            createdSMs.push({
              id: smId,
              name: safeName,
              displayName,
              stationNumber: cfg.stationNumber ?? 1,
              description: `Copy of ${source.displayName ?? source.name}`,
              devices: newDevices,
              nodes: newNodes,
              edges: newEdges,
              smOutputs: newOutputs,
            });
            newSmIds.push({ stationId: cfg.stationId, smId });
            continue;
          }

          // ── Generate mode ─────────────────────────────────────────────────
          const smId = uid();
          const sm = {
            id: smId,
            name: safeName,
            displayName,
            stationNumber: cfg.stationNumber ?? 1,
            description: '',
            devices: [],
            nodes: [],
            edges: [],
            smOutputs: [],
          };

          const nodeX = 400;
          let nodeY = 100;
          const yStep = 180;
          const nodeList = []; // track { id, type } for edge creation

          // Helper: create a state node and push it
          const mkState = (label, opts = {}) => {
            const nid = uid();
            sm.nodes.push({
              id: nid,
              type: 'stateNode',
              position: { x: nodeX, y: nodeY },
              data: {
                stepNumber: 0,
                label,
                actions: opts.actions ?? [],
                isInitial: opts.isInitial ?? false,
                isComplete: opts.isComplete ?? false,
              },
            });
            nodeList.push({ id: nid, type: 'stateNode' });
            nodeY += yStep;
            return nid;
          };

          // Helper: create a standard edge between two nodes
          const mkEdge = (srcId, tgtId, label, extraData = {}) => {
            sm.edges.push({
              id: uid(),
              source: srcId,
              sourceHandle: extraData.sourceHandle ?? null,
              target: tgtId,
              targetHandle: null,
              type: 'routableEdge',
              animated: false,
              style: extraData.style ?? { stroke: '#6b7280', strokeWidth: 2 },
              markerEnd: extraData.markerEnd ?? { type: 'ArrowClosed', color: '#6b7280' },
              label: label ?? '',
              labelStyle: { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace' },
              labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
              data: { conditionType: extraData.conditionType ?? 'always', label: label ?? '', ...extraData.data },
            });
          };

          // 0. Home node is always first (isInitial = true)
          const machineType = get().project?.machineConfig?.machineType ?? 'indexing';
          const homeNodeId = mkState('Home', { isInitial: true });

          // 1. For indexing machines, add "Wait for Index Complete" decision node after Home
          if (machineType === 'indexing') {
            const waitId = uid();
            sm.nodes.push({
              id: waitId,
              type: 'decisionNode',
              position: { x: nodeX, y: nodeY },
              data: {
                decisionType: 'signal',
                signalName: 'IndexComplete',
                signalSource: 'Dial_Indexer',
                signalSmName: 'Dial_Indexer',
                signalType: 'state',
                exitCount: 1,
                exit1Label: 'Ready',
                stateNumber: 0,
              },
            });
            nodeList.push({ id: waitId, type: 'decisionNode' });
            nodeY += yStep;
          }

          // 2. Type-specific nodes & devices
          if ((cfg.stationType === 'load' || cfg.stationType === 'unload') && cfg.axes && cfg.axes.length > 0) {
            // ── Dynamic axes-based generation ──────────────────────────────
            // Build devices from axes array: [{ label, type }]
            const axisDevices = []; // { devId, label, type, extOp, retOp, extExtra, retExtra }

            let axisNum = 1;
            for (const axis of cfg.axes) {
              const devId = uid();
              const axLabel = axis.label || `A${axisNum}`;
              const devName = `${safeName}${axLabel}`;
              const devDisplay = `${displayName} ${axLabel}`;

              if (axis.type === 'pneumatic') {
                // Sensor arrangement based on axis role:
                // Z/vertical = 1-sensor Ret only (1000ms extend timer)
                // X/horizontal and others = 2-sensor (Ext + Ret)
                const pLbl = axLabel.toLowerCase();
                const isVertPneu = pLbl === 'z' || pLbl.includes('vert');
                const sensorArr = isVertPneu ? '1-sensor (Ext only)' : '2-sensor (Ext + Ret)';
                const devObj = {
                  id: devId, type: 'PneumaticLinearActuator',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                  sensorArrangement: isVertPneu ? '1-sensor (Ret only)' : '2-sensor (Ext + Ret)',
                };
                if (isVertPneu) {
                  devObj.extendDelayMs = 1000;
                }
                sm.devices.push(devObj);
                axisDevices.push({
                  devId, label: axLabel, type: 'pneumatic',
                  extOp: 'Extend', retOp: 'Retract', extExtra: {}, retExtra: {},
                });
              } else if (axis.type === 'servo') {
                // Determine positions based on label context
                const lbl = axLabel.toLowerCase();
                const isVertical = lbl === 'z' || lbl.includes('vert');
                const isHorizontal = lbl === 'x' || lbl.includes('horiz');
                let positions, extPos, retPos;
                if (isVertical) {
                  positions = [
                    { name: 'Pick', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
                    { name: 'Place', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
                    { name: 'Retract', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
                  ];
                  extPos = 'Pick'; retPos = 'Retract';
                } else if (isHorizontal) {
                  positions = [
                    { name: 'Pick', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
                    { name: 'Place', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
                  ];
                  extPos = 'Place'; retPos = 'Pick';
                } else {
                  positions = [
                    { name: 'Home', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
                    { name: 'Work', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
                  ];
                  extPos = 'Work'; retPos = 'Home';
                }
                sm.devices.push({
                  id: devId, type: 'ServoAxis',
                  name: devName, displayName: devDisplay,
                  tagStem: devName, axisNumber: axisNum, motionType: 'linear',
                  positions,
                  speedProfiles: [{ name: 'Fast', speed: 0, accel: 0, decel: 0 }],
                  sensorArrangement: 'none',
                });
                axisDevices.push({
                  devId, label: axLabel, type: 'servo',
                  extOp: 'ServoMove', retOp: 'ServoMove',
                  extExtra: { positionName: extPos }, retExtra: { positionName: retPos },
                });
              } else if (axis.type === 'gripper') {
                sm.devices.push({
                  id: devId, type: 'PneumaticGripper',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                  sensorArrangement: 'No sensors',
                  engageDelayMs: 250,
                  disengageDelayMs: 250,
                });
                axisDevices.push({
                  devId, label: axLabel, type: 'gripper',
                  extOp: 'Engage', retOp: 'Disengage', extExtra: {}, retExtra: {},
                });
              } else if (axis.type === 'vacuum') {
                sm.devices.push({
                  id: devId, type: 'PneumaticVacGenerator',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                });
                axisDevices.push({
                  devId, label: axLabel, type: 'vacuum',
                  extOp: 'VacOn', retOp: 'VacOff', extExtra: {}, retExtra: {},
                });
              } else if (axis.type === 'sensor') {
                sm.devices.push({
                  id: devId, type: 'DigitalSensor',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                });
                axisDevices.push({
                  devId, label: axLabel, type: 'sensor',
                  extOp: 'Verify', retOp: null, extExtra: {}, retExtra: {},
                });
              }
              axisNum++;
            }

            // Build PnP-style sequence from axes
            // Separate grippers/vacuums from motion axes and sensors
            const motionAxes = axisDevices.filter(a => a.type === 'pneumatic' || a.type === 'servo');
            const gripAxes = axisDevices.filter(a => a.type === 'gripper' || a.type === 'vacuum');
            const sensorAxes = axisDevices.filter(a => a.type === 'sensor');

            // Build home actions — each axis returns to home/retract position
            const homeActions = [];
            for (const ax of axisDevices) {
              if (ax.type === 'pneumatic') {
                homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'Retract' });
              } else if (ax.type === 'servo') {
                homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'ServoMove', ...ax.retExtra });
              } else if (ax.type === 'gripper') {
                homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'Disengage' });
              } else if (ax.type === 'vacuum') {
                homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'VacOff' });
              }
            }
            // Inject home actions into the initial Home node
            const homeNode = sm.nodes.find(n => n.id === homeNodeId);
            if (homeNode) homeNode.data.actions = homeActions;

            if (motionAxes.length >= 2) {
              // PnP-style: identify X (horizontal) and Z (vertical) by label, rest are mid axes
              // Z = label contains 'z' or 'vert'; X = label contains 'x' or 'horiz'; fallback: first=X, second=Z
              let zIdx = motionAxes.findIndex(a => /^z$/i.test(a.label) || /vert/i.test(a.label));
              let xIdx = motionAxes.findIndex(a => /^x$/i.test(a.label) || /horiz/i.test(a.label));
              if (zIdx === -1) zIdx = 1; // default: second axis is Z
              if (xIdx === -1) xIdx = 0; // default: first axis is X
              const xAxis = motionAxes[xIdx];
              const zAxis = motionAxes[zIdx];
              const midAxes = motionAxes.filter((_, i) => i !== xIdx && i !== zIdx);
              const grip = gripAxes.length > 0 ? gripAxes[0] : null;

              // For servo Z, separate position refs for pick-down vs place-down vs retract
              const zPickDown = zAxis.type === 'servo' ? { positionName: 'Pick' } : {};
              const zPlaceDown = zAxis.type === 'servo' ? { positionName: 'Place' } : {};
              const zRetract = zAxis.type === 'servo' ? { positionName: 'Retract' } : {};
              const zDownOp = zAxis.extOp;
              const zRetOp = zAxis.retOp;

              // Standard PnP: Home = X at pick, Z retracted
              // Sequence: Z to pick → [grip/mid work] → Z retract → X to place → Z to place → [grip/mid work] → Z retract → X to pick
              // All grip + mid axes do their "engage/extend" at pick, and "release/retract" at place
              mkState(`${zAxis.label} to Pick`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zDownOp, ...zPickDown }] });
              if (grip) {
                mkState(`${grip.label} Engage`, { actions: [{ id: uid(), deviceId: grip.devId, operation: grip.extOp, ...grip.extExtra }] });
              }
              for (const mid of midAxes) {
                mkState(`${mid.label} Extend`, { actions: [{ id: uid(), deviceId: mid.devId, operation: mid.extOp, ...mid.extExtra }] });
              }
              mkState(`${zAxis.label} Retract`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zRetOp, ...zRetract }] });
              mkState(`${xAxis.label} to Place`, { actions: [{ id: uid(), deviceId: xAxis.devId, operation: xAxis.extOp, ...xAxis.extExtra }] });
              mkState(`${zAxis.label} to Place`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zDownOp, ...zPlaceDown }] });
              if (grip) {
                mkState(`${grip.label} Release`, { actions: [{ id: uid(), deviceId: grip.devId, operation: grip.retOp, ...grip.retExtra }] });
              }
              for (const mid of [...midAxes].reverse()) {
                mkState(`${mid.label} Retract`, { actions: [{ id: uid(), deviceId: mid.devId, operation: mid.retOp, ...mid.retExtra }] });
              }
              mkState(`${zAxis.label} Retract (2)`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zRetOp, ...zRetract }] });
              mkState(`${xAxis.label} to Pick`, { actions: [{ id: uid(), deviceId: xAxis.devId, operation: xAxis.retOp, ...xAxis.retExtra }] });
            } else {
              // Single axis or no motion axes — simple extend/retract
              for (const ax of axisDevices) {
                if (ax.extOp) {
                  mkState(`${ax.label} Extend`, { actions: [{ id: uid(), deviceId: ax.devId, operation: ax.extOp, ...ax.extExtra }] });
                }
              }
              for (const ax of [...axisDevices].reverse()) {
                if (ax.retOp) {
                  mkState(`${ax.label} Retract`, { actions: [{ id: uid(), deviceId: ax.devId, operation: ax.retOp, ...ax.retExtra }] });
                }
              }
            }

            // Sensor checks at end of sequence
            for (const sen of sensorAxes) {
              mkState(`Check ${sen.label}`, { actions: [{ id: uid(), deviceId: sen.devId, operation: sen.extOp }] });
            }

          } else if (cfg.stationType === 'verify') {
            if (cfg.verifyType === 'vision') {
              const devId = uid();
              const jobName = `${displayName}_Inspect`;
              sm.devices.push({
                id: devId, type: 'VisionSystem',
                name: `${safeName}Cam`, displayName: `${displayName} Camera`,
                tagStem: `${safeName}Cam`,
                jobs: [{ id: uid(), name: jobName, outcomes: ['Pass', 'Fail'], numericOutputs: [] }],
              });
              mkState('Vision Inspect', { actions: [{ id: uid(), deviceId: devId, operation: 'VisionInspect', jobName, ptFieldName: jobName, outcomes: [{ id: uid(), label: 'Pass' }, { id: uid(), label: 'Fail' }] }] });
            } else if (cfg.verifyType === 'sensor') {
              const devId = uid();
              sm.devices.push({
                id: devId, type: 'DigitalSensor',
                name: `${safeName}Sensor`, displayName: `${displayName} Sensor`,
                tagStem: `${safeName}Sensor`,
              });
              mkState('Check Sensor', { actions: [{ id: uid(), deviceId: devId, operation: 'Verify' }] });
            } else if (cfg.verifyType === 'mechanical') {
              const devId = uid();
              sm.devices.push({
                id: devId, type: 'PneumaticLinearActuator',
                name: `${safeName}Probe`, displayName: `${displayName} Probe`,
                tagStem: `${safeName}Probe`,
                sensorArrangement: '2-sensor (Ext + Ret)',
              });
              mkState('Extend Probe', { actions: [{ id: uid(), deviceId: devId, operation: 'Extend' }] });
              mkState('Retract Probe', { actions: [{ id: uid(), deviceId: devId, operation: 'Retract' }] });
            }
          } else if ((cfg.stationType === 'process' || cfg.stationType === 'reject' || cfg.stationType === 'unload') && cfg.axes && cfg.axes.length > 0) {
            // ── Process / Reject / Unload station: create devices, empty sequence ─
            // Reject & Unload also prepend a gating decision node (autoOpen) so the
            // user picks which upstream vision result gates this station's sequence.
            if (cfg.stationType === 'reject' || cfg.stationType === 'unload') {
              const gateId = uid();
              const gateLabel = cfg.stationType === 'reject' ? 'Run if Rejected' : 'Run if Good Part';
              sm.nodes.push({
                id: gateId,
                type: 'decisionNode',
                position: { x: nodeX, y: nodeY },
                data: {
                  decisionType: 'signal',
                  signalName: gateLabel,
                  signalSource: 'Part Results',
                  signalSmName: null,
                  signalType: 'partResult',
                  exitCount: 1,
                  exit1Label: cfg.stationType === 'reject' ? 'Reject' : 'Good',
                  stateNumber: 0,
                  autoOpenPopup: true,
                },
              });
              nodeList.push({ id: gateId, type: 'decisionNode' });
              nodeY += yStep;
            }
            let axisNum = 1;
            for (const axis of cfg.axes) {
              const devId = uid();
              const axLabel = axis.label || `A${axisNum}`;
              const devName = `${safeName}${axLabel}`;
              const devDisplay = `${displayName} ${axLabel}`;

              if (axis.type === 'pneumatic') {
                sm.devices.push({
                  id: devId, type: 'PneumaticLinearActuator',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                  sensorArrangement: '2-sensor (Ext + Ret)',
                });
              } else if (axis.type === 'servo') {
                sm.devices.push({
                  id: devId, type: 'ServoAxis',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                  positions: [
                    { name: 'Home', defaultValue: 0, moveType: 'Pos', isHome: true },
                    { name: 'Work', defaultValue: 0, moveType: 'Pos' },
                  ],
                });
              } else if (axis.type === 'gripper') {
                sm.devices.push({
                  id: devId, type: 'PneumaticGripper',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                  sensorArrangement: 'No sensors (timer only)',
                  extendDelay: 250, retractDelay: 250,
                });
              } else if (axis.type === 'vacuum') {
                sm.devices.push({
                  id: devId, type: 'PneumaticVacGenerator',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                });
              } else if (axis.type === 'sensor') {
                sm.devices.push({
                  id: devId, type: 'DigitalSensor',
                  name: devName, displayName: devDisplay,
                  tagStem: devName,
                });
              }
              axisNum++;
            }
            // Add a single empty node — user fills in the actual sequence
            const processLabel = cfg.stationType === 'reject' ? 'Reject' :
                                 cfg.stationType === 'unload' ? 'Unload' : 'Process';
            mkState(processLabel, {});
          }
          // For load/unload with no axes: just Wait → Complete

          // 3. Cycle Complete node
          mkState('Cycle Complete', { isComplete: true });

          // 4. Create edges connecting nodes sequentially
          for (let i = 0; i < nodeList.length - 1; i++) {
            const src = nodeList[i];
            const tgt = nodeList[i + 1];
            // Edge FROM a decision node needs sourceHandle exit-single and green styling
            if (src.type === 'decisionNode') {
              mkEdge(src.id, tgt.id, 'Ready', {
                sourceHandle: 'exit-single',
                conditionType: 'ready',
                style: { stroke: '#16a34a', strokeWidth: 2 },
                data: { isDecisionExit: true, exitColor: 'pass', outcomeLabel: 'Ready' },
              });
            } else {
              mkEdge(src.id, tgt.id, '');
            }
          }

          createdSMs.push(sm);
          newSmIds.push({ stationId: cfg.stationId, smId });
        }

        // Add all SMs to project, sorted by station number
        set(s => {
          const allSms = [...(s.project.stateMachines ?? []), ...createdSMs];
          allSms.sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999));
          return {
            project: {
              ...s.project,
              stateMachines: allSms,
            },
          };
        });

        // Link each SM to its station
        for (const { stationId, smId } of newSmIds) {
          if (stationId) {
            set(s => {
              const mc = { ...(s.project.machineConfig ?? defaultMachineConfig) };
              mc.stations = (mc.stations ?? []).map(st => {
                if (st.id !== stationId) return st;
                const smIds = [...(st.smIds ?? [])];
                if (!smIds.includes(smId)) smIds.push(smId);
                return { ...st, smIds };
              });
              return { project: { ...s.project, machineConfig: mc } };
            });
          }
        }

        return newSmIds.map(x => x.smId);
      },

      reorderStateMachines(fromIndex, toIndex) {
        get()._pushHistory();
        set(s => {
          const sms = [...s.project.stateMachines];
          const [moved] = sms.splice(fromIndex, 1);
          sms.splice(toIndex, 0, moved);
          return { project: { ...s.project, stateMachines: sms } };
        });
      },

      reorderRecipes(fromIndex, toIndex) {
        get()._pushHistory();
        set(s => {
          const recipes = [...(s.project.recipes ?? [])];
          const [moved] = recipes.splice(fromIndex, 1);
          recipes.splice(toIndex, 0, moved);
          return { project: { ...s.project, recipes } };
        });
      },

      setActiveSm(id) {
        set({ activeSmId: id, selectedNodeId: null, selectedEdgeId: null });
      },

      // ── Device actions ────────────────────────────────────────────────────
      addDevice(smId, deviceData) {
        get()._pushHistory();
        const device = { id: uid(), ...deviceData };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: [...sm.devices, device] }
                : sm
            )),
        }));
        // After adding a VisionSystem device, sync vision PT fields
        if (deviceData.type === 'VisionSystem') {
          get().syncVisionPartTracking(smId);
        }
        return device.id;
      },

      updateDevice(smId, deviceId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.map(d => d.id === deviceId ? { ...d, ...updates } : d) }
                : sm
            )),
        }));
        // After updating a VisionSystem device, sync vision PT fields
        const dev = get().project?.stateMachines?.find(s => s.id === smId)?.devices?.find(d => d.id === deviceId);
        if (dev?.type === 'VisionSystem') {
          get().syncVisionPartTracking(smId);
        }
      },

      /**
       * Refresh subjects: re-sync auto-vision params, clean up orphans,
       * and force a state update so nodes pick up any device changes.
       */
      refreshSubjects(smId) {
        const sm = get().project?.stateMachines?.find(s => s.id === smId);
        if (!sm) return;
        // Sync vision params
        get().syncVisionPartTracking(smId);
        // Force a shallow-copy of devices array to trigger re-render
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
              sm2.id === smId
                ? { ...sm2, devices: [...sm2.devices] }
                : sm2
            )),
        }));
      },

      deleteDevice(smId, deviceId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.filter(d => d.id !== deviceId) }
                : sm
            )),
        }));
      },

      /**
       * Duplicate a device within the same SM (or to a target SM).
       * Returns the new device's id.
       */
      duplicateDevice(smId, deviceId, targetSmId) {
        get()._pushHistory();
        const allSMs = _getSmArray(get());
        const sm = allSMs.find(s => s.id === smId);
        const device = sm?.devices?.find(d => d.id === deviceId);
        if (!device) return null;
        const newId = uid();
        // Generate unique PLC tag name and display name
        const newName = _uniqueDeviceName(device.name, allSMs);
        const newDisplayName = newName !== device.name
          ? (device.displayName ?? device.name) + ' (Copy)'
          : device.displayName ?? device.name;
        const copy = {
          ...JSON.parse(JSON.stringify(device)),
          id: newId,
          name: newName,
          displayName: newDisplayName,
        };
        const destSmId = targetSmId ?? smId;
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
            sm2.id === destSmId
              ? { ...sm2, devices: [...sm2.devices, copy] }
              : sm2
          )),
        }));
        return newId;
      },

      /** Remove duplicate / orphaned _autoVision Parameter devices and fix names. */
      deduplicateAutoVisionParams() {
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              // Build set of valid keys from current vision device job definitions
              const validKeys = new Set();
              for (const vd of (sm.devices ?? []).filter(d => d.type === 'VisionSystem')) {
                for (const job of (vd.jobs ?? [])) {
                  for (const outcome of (job.outcomes ?? ['Pass', 'Fail'])) {
                    validKeys.add(`${vd.id}|${job.name}|${outcome}`);
                  }
                }
              }

              const seen = new Set();
              const cleaned = (sm.devices ?? []).map(d => {
                if (!d._autoVision) return d;
                const key = `${d._visionDeviceId}|${d._visionJobName}|${d._outcomeLabel}`;
                if (!validKeys.has(key)) return null;   // orphaned
                if (seen.has(key)) return null;          // duplicate
                seen.add(key);
                // Normalize name/displayName to just the outcome label
                const correctName = (d._outcomeLabel || 'Result').replace(/[^a-zA-Z0-9_]/g, '');
                const correctDisplay = d._outcomeLabel || 'Result';
                if (d.name !== correctName || d.displayName !== correctDisplay) {
                  return { ...d, name: correctName, displayName: correctDisplay };
                }
                return d;
              }).filter(Boolean);
              return cleaned.length === (sm.devices ?? []).length &&
                cleaned.every((d, i) => d === (sm.devices ?? [])[i])
                ? sm : { ...sm, devices: cleaned };
            })),
        }));
      },

      /**
       * Sync Part Tracking fields for vision jobs.
       * For every vision device + job, ensures a PT field exists.
       * No longer creates auto-vision Parameter devices.
       */
      syncVisionPartTracking(smId) {
        const sm = get().project?.stateMachines?.find(s => s.id === smId);
        if (!sm) return;

        const visionDevices = (sm.devices ?? []).filter(d => d.type === 'VisionSystem');
        if (visionDevices.length === 0) return;

        const ptFields = get().project?.partTracking?.fields ?? [];

        for (const vd of visionDevices) {
          for (const job of (vd.jobs ?? [])) {
            const ptName = job.name;
            if (!ptName) continue;

            // 1. Pass/Fail boolean field (existing behavior)
            const existsBool = ptFields.some(f => f.name === ptName && f._visionLinked);
            if (!existsBool) {
              get().addTrackingField({
                name: ptName,
                type: 'boolean',
                description: `Vision job result — auto-linked from ${vd.displayName ?? vd.name}`,
                _visionLinked: true,
                _visionSmId: smId,
                _visionSmName: sm.name,
                _visionDeviceId: vd.id,
                _visionDeviceName: vd.displayName ?? vd.name,
                _visionJobId: job.id,
                _visionJobName: job.name,
              });
            }

            // 2. Numeric output fields (REAL values from vision measurements)
            for (const output of (job.numericOutputs ?? [])) {
              if (!output.name) continue;
              const fieldName = `${ptName}_${output.name}`;
              // Re-read fields each iteration since addTrackingField mutates
              const currentFields = get().project?.partTracking?.fields ?? [];
              const existsReal = currentFields.some(f => f.name === fieldName && f._visionLinked);
              if (!existsReal) {
                get().addTrackingField({
                  name: fieldName,
                  type: 'real',
                  unit: output.unit || '',
                  description: `Vision output — ${output.name} from ${vd.displayName ?? vd.name} / ${job.name}`,
                  _visionLinked: true,
                  _visionSmId: smId,
                  _visionSmName: sm.name,
                  _visionDeviceId: vd.id,
                  _visionDeviceName: vd.displayName ?? vd.name,
                  _visionJobId: job.id,
                  _visionJobName: job.name,
                  _visionOutputName: output.name,
                });
              }
            }
          }
        }
      },

      // ── Node (State Step) actions ─────────────────────────────────────────
      onNodesChange(smId, changes) {
        if (changes.some(c => c.type === 'remove')) get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, nodes: applyNodeChanges(changes, sm.nodes) }
                : sm
            )),
        }));
      },

      addNode(smId, options = {}) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
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
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, nodes: [...sm.nodes, node] } : sm
            )),
          selectedNodeId: id,
          selectedEdgeId: null,
        }));
        return id;
      },

      /** Insert a Home node at the beginning of the SM, making it isInitial.
       *  If there's already an initial node, it loses isInitial and gets an edge from Home. */
      addHomeNode(smId) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;

        // Check if home already exists
        const existingHome = (sm.nodes ?? []).find(n => n.data?.isInitial);

        const homeId = uid();
        // Position above the current first node
        const firstNode = (sm.nodes ?? []).sort((a, b) => a.position.y - b.position.y)[0];
        const homePos = firstNode
          ? { x: firstNode.position.x, y: firstNode.position.y - 200 }
          : { x: 300, y: 80 };

        const homeNode = {
          id: homeId,
          type: 'stateNode',
          position: homePos,
          data: {
            stepNumber: 0,
            label: 'Home',
            actions: [],
            isInitial: true,
          },
        };

        // Remove isInitial from old initial node
        const updatedNodes = (sm.nodes ?? []).map(n =>
          n.data?.isInitial ? { ...n, data: { ...n.data, isInitial: false } } : n
        );

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
            sm2.id === smId
              ? { ...sm2, nodes: [homeNode, ...updatedNodes] }
              : sm2
          )),
          selectedNodeId: homeId,
          selectedEdgeId: null,
        }));

        // Connect Home to the old initial node
        if (existingHome) {
          get().addEdge(smId, {
            source: homeId,
            sourceHandle: null,
            target: existingHome.id,
            targetHandle: null,
          });
        }

        return homeId;
      },

      addDecisionNode(smId, nodeConfig) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const node = {
          type: 'decisionNode',
          ...nodeConfig,
        };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, nodes: [...sm.nodes, node] } : sm
            )),
          selectedNodeId: node.id,
          selectedEdgeId: null,
        }));
        return node.id;
      },

      addDecisionBranches(smId, nodeId, exit1Label, exit2Label) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const decisionNode = sm.nodes.find(n => n.id === nodeId);
        if (!decisionNode) return;

        // If branches already exist, update their labels instead of creating duplicates
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) {
          const passEdge = existingOut.find(e => e.sourceHandle === 'exit-pass');
          const failEdge = existingOut.find(e => e.sourceHandle === 'exit-fail');
          set(s => ({
            project: _updateProject(s, sms => sms.map(sm2 => {
              if (sm2.id !== smId) return sm2;
              const updatedEdges = sm2.edges.map(e => {
                if (passEdge && e.id === passEdge.id) {
                  return { ...e, label: exit1Label, data: { ...e.data, label: exit1Label, outcomeLabel: exit1Label } };
                }
                if (failEdge && e.id === failEdge.id) {
                  return { ...e, label: exit2Label, data: { ...e.data, label: exit2Label, outcomeLabel: exit2Label } };
                }
                return e;
              });
              // Update auto-created child node labels if they still match old edge labels
              const updatedNodes = sm2.nodes.map(n => {
                if (passEdge && n.id === passEdge.target && n.data?.label === passEdge.label) {
                  return { ...n, data: { ...n.data, label: exit1Label } };
                }
                if (failEdge && n.id === failEdge.target && n.data?.label === failEdge.label) {
                  return { ...n, data: { ...n.data, label: exit2Label } };
                }
                return n;
              });
              return { ...sm2, edges: updatedEdges, nodes: updatedNodes };
            })),
          }));
          return;
        }

        const passId = uid();
        const failId = uid();
        const passEdgeId = uid();
        const failEdgeId = uid();

        const passNode = {
          id: passId,
          type: 'stateNode',
          position: { x: decisionNode.position.x - 280, y: decisionNode.position.y + 220 },
          data: { label: exit1Label, actions: [], isInitial: false, stepNumber: sm.nodes.length },
        };
        const failNode = {
          id: failId,
          type: 'stateNode',
          position: { x: decisionNode.position.x + 280, y: decisionNode.position.y + 220 },
          data: { label: exit2Label, actions: [], isInitial: false, stepNumber: sm.nodes.length + 1 },
        };

        const passEdge = {
          id: passEdgeId,
          source: nodeId,
          sourceHandle: 'exit-pass',
          target: passId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: exit1Label,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: exit1Label, outcomeLabel: exit1Label, isDecisionExit: true, exitColor: 'pass' },
        };
        const failEdge = {
          id: failEdgeId,
          source: nodeId,
          sourceHandle: 'exit-fail',
          target: failId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#dc2626', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#dc2626' },
          label: exit2Label,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#dc2626', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: exit2Label, outcomeLabel: exit2Label, isDecisionExit: true, exitColor: 'fail' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, passNode, failNode],
                edges: [...sm.edges, passEdge, failEdge],
              }
            )),
        }));
      },

      addDecisionSingleBranch(smId, nodeId, exitLabel) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const decisionNode = sm.nodes.find(n => n.id === nodeId);
        if (!decisionNode) return;

        // If the single exit already exists, update its label (and matching child node label) instead of creating a duplicate
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) {
          const singleEdge = existingOut.find(e => e.sourceHandle === 'exit-single') ?? existingOut[0];
          set(s => ({
            project: _updateProject(s, sms => sms.map(sm2 => {
              if (sm2.id !== smId) return sm2;
              const updatedEdges = sm2.edges.map(e => {
                if (e.id === singleEdge.id) {
                  return { ...e, label: exitLabel, data: { ...e.data, label: exitLabel } };
                }
                return e;
              });
              const updatedNodes = sm2.nodes.map(n => {
                if (singleEdge && n.id === singleEdge.target && n.data?.label === singleEdge.label) {
                  return { ...n, data: { ...n.data, label: exitLabel } };
                }
                return n;
              });
              return { ...sm2, edges: updatedEdges, nodes: updatedNodes };
            })),
          }));
          return;
        }

        const nextId = uid();
        const edgeId = uid();

        const nextNode = {
          id: nextId,
          type: 'stateNode',
          position: { x: decisionNode.position.x, y: decisionNode.position.y + 180 },
          data: { label: exitLabel, actions: [], isInitial: false, stepNumber: sm.nodes.length },
        };

        const edge = {
          id: edgeId,
          source: nodeId,
          sourceHandle: 'exit-single',
          target: nextId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: exitLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          // No outcomeLabel on single-exit — the wait condition is the node itself, no branch label needed
          data: { conditionType: 'ready', label: exitLabel, isDecisionExit: true, exitColor: 'pass' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, nextNode],
                edges: [...sm.edges, edge],
              }
            )),
        }));
      },

      /** Add a retry branch (bottom exit) to a decision/wait node that already has pass/fail branches */
      addDecisionRetryBranch(smId, nodeId) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const decisionNode = sm.nodes.find(n => n.id === nodeId);
        if (!decisionNode) return;

        // Don't create duplicate retry branch
        const existingRetry = sm.edges.find(e => e.source === nodeId && e.sourceHandle === 'exit-retry');
        if (existingRetry) return;

        const retryNodeId = uid();
        const retryEdgeId = uid();

        const retryNode = {
          id: retryNodeId,
          type: 'stateNode',
          position: { x: decisionNode.position.x, y: decisionNode.position.y + 220 },
          data: { label: 'Retry_Fail', actions: [], isInitial: false, stepNumber: sm.nodes.length },
        };

        const retryEdge = {
          id: retryEdgeId,
          source: nodeId,
          sourceHandle: 'exit-retry',
          target: retryNodeId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#f59e0b', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#f59e0b' },
          label: 'Retry_Fail',
          labelStyle: { fill: '#000', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#f59e0b', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: 'Retry_Fail', outcomeLabel: 'Retry_Fail', isDecisionExit: true, exitColor: 'retry' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, retryNode],
                edges: [...sm.edges, retryEdge],
              }
            )),
        }));
      },

      // ── Vision node branches (side-exit like DecisionNode) ────────────────

      addVisionBranches(smId, nodeId, passLabel, failLabel, ptFieldName) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const visionNode = sm.nodes.find(n => n.id === nodeId);
        if (!visionNode) return;

        // Don't create duplicates if branches already exist
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const passId = uid();
        const failId = uid();
        const passEdgeId = uid();
        const failEdgeId = uid();

        // Pass branch node (left) — blank node (PT updated inside vision node)
        const passNode = {
          id: passId,
          type: 'stateNode',
          position: { x: visionNode.position.x - 280, y: visionNode.position.y + 220 },
          data: {
            label: passLabel,
            actions: [],
            isInitial: false,
          },
        };
        // Fail branch node (right) — blank node (PT updated inside vision node)
        const failNode = {
          id: failId,
          type: 'stateNode',
          position: { x: visionNode.position.x + 280, y: visionNode.position.y + 220 },
          data: {
            label: failLabel,
            actions: [],
            isInitial: false,
          },
        };

        const passEdge = {
          id: passEdgeId,
          source: nodeId,
          sourceHandle: 'exit-pass',
          target: passId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: passLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: passLabel, outcomeLabel: passLabel, isDecisionExit: true, exitColor: 'pass' },
        };
        const failEdge = {
          id: failEdgeId,
          source: nodeId,
          sourceHandle: 'exit-fail',
          target: failId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#dc2626', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#dc2626' },
          label: failLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#dc2626', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: failLabel, outcomeLabel: failLabel, isDecisionExit: true, exitColor: 'fail' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, passNode, failNode],
                edges: [...sm.edges, passEdge, failEdge],
              }
            )),
        }));
      },

      addVisionSingleBranch(smId, nodeId, exitLabel, ptFieldName) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const visionNode = sm.nodes.find(n => n.id === nodeId);
        if (!visionNode) return;

        // Don't create duplicates
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const nextId = uid();
        const edgeId = uid();

        // Single branch node below — blank node (PT updated inside vision node)
        const nextNode = {
          id: nextId,
          type: 'stateNode',
          position: { x: visionNode.position.x, y: visionNode.position.y + 220 },
          data: {
            label: exitLabel,
            actions: [],
            isInitial: false,
          },
        };

        const edge = {
          id: edgeId,
          source: nodeId,
          sourceHandle: 'exit-single',
          target: nextId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
          label: 'Pass / Fail',
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#6b7280', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: 'Pass / Fail', outcomeLabel: 'Pass / Fail', isDecisionExit: true, exitColor: 'single' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, nextNode],
                edges: [...sm.edges, edge],
              }
            )),
        }));
      },

      updateNodeData(smId, nodeId, dataUpdates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
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
            )),
        }));
      },

      deleteNode(smId, nodeId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.filter(n => n.id !== nodeId),
                    edges: sm.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
                  }
                : sm
            )),
          selectedNodeId: null,
        }));
      },

      renumberSteps(smId) {
        get()._pushHistory();
        // Renumber all nodes by topological order (or current order)
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              if (sm.id !== smId) return sm;
              const nodes = sm.nodes.map((n, i) => ({
                ...n,
                data: { ...n.data, stepNumber: i, isInitial: i === 0 },
              }));
              return { ...sm, nodes };
            })),
        }));
      },

      // ── Edge (Transition) actions ─────────────────────────────────────────
      onEdgesChange(smId, changes) {
        if (changes.some(c => c.type === 'remove')) get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, edges: applyEdgeChanges(changes, sm.edges) }
                : sm
            )),
        }));
      },

      addEdge(smId, connection, conditionData) {
        get()._pushHistory();
        const id = uid();
        const label = conditionData?.label ?? 'Ready';
        const isDecExit = conditionData?.isDecisionExit === true;
        const isPass = conditionData?.exitColor === 'pass';
        const isRetry = conditionData?.exitColor === 'retry';
        const decColor = isRetry ? '#f59e0b' : isPass ? '#16a34a' : '#dc2626';
        const edge = {
          id,
          source: connection.source,
          sourceHandle: connection.sourceHandle ?? null,
          target: connection.target,
          targetHandle: connection.targetHandle ?? null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: isDecExit ? decColor : '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: isDecExit ? decColor : '#6b7280' },
          label,
          labelStyle: isDecExit
            ? { fill: isRetry ? '#000' : '#fff', fontWeight: 600, fontSize: 11 }
            : { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace', whiteSpace: 'pre-line', textAlign: 'left', lineHeight: '1.3' },
          labelBgStyle: isDecExit
            ? { fill: decColor, rx: 4, ry: 4 }
            : { fill: '#f9fafb', fillOpacity: 0.95 },
          ...(isDecExit ? { labelBgPadding: [4, 8] } : {}),
          data: conditionData ?? { conditionType: 'ready', label: 'Ready' },
        };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, edges: [...sm.edges, edge] } : sm
            )),
        }));
        return id;
      },

      updateEdge(smId, edgeId, conditionData) {
        get()._pushHistory();
        const label = conditionData?.label ?? 'Ready';
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    edges: sm.edges.map(e =>
                      e.id === edgeId ? { ...e, label, data: conditionData } : e
                    ),
                  }
                : sm
            )),
        }));
      },

      /** Persist the waypoints array for a routable edge (called on every drag tick). */
      updateEdgeWaypoints(smId, edgeId, waypoints, manualRoute = false) {
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                edges: sm.edges.map(e =>
                  e.id !== edgeId ? e : {
                    ...e,
                    data: { ...e.data, waypoints, ...(manualRoute ? { manualRoute: true } : {}) },
                  }
                ),
              }
            )),
        }));
      },

      deleteEdge(smId, edgeId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, edges: sm.edges.filter(e => e.id !== edgeId) }
                : sm
            )),
          selectedEdgeId: null,
        }));
      },

      // ── Action (within a node) actions ────────────────────────────────────
      addAction(smId, nodeId, actionData) {
        get()._pushHistory();
        const action = { id: uid(), ...actionData };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
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
            )),
        }));
        return action.id;
      },

      updateAction(smId, nodeId, actionId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
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
            )),
        }));
      },

      deleteAction(smId, nodeId, actionId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
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
            )),
        }));
      },

      reorderDevices(smId, movedDeviceId, targetDeviceId, insertAfter) {
        if (movedDeviceId === targetDeviceId) return;
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              if (sm.id !== smId) return sm;
              const devices = [...(sm.devices ?? [])];
              const fromIdx = devices.findIndex(d => d.id === movedDeviceId);
              let toIdx = devices.findIndex(d => d.id === targetDeviceId);
              if (fromIdx < 0 || toIdx < 0) return sm;
              const [moved] = devices.splice(fromIdx, 1);
              // Recalculate toIdx after removal
              toIdx = devices.findIndex(d => d.id === targetDeviceId);
              const insertIdx = insertAfter ? toIdx + 1 : toIdx;
              devices.splice(insertIdx, 0, moved);
              return { ...sm, devices };
            })),
        }));
      },

      // ── Part Tracking actions ─────────────────────────────────────────────
      addTrackingField(fieldData) {
        get()._pushHistory();
        const field = { id: uid(), name: 'NewField', dataType: 'boolean', description: '', ...fieldData };
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: [...(s.project.partTracking?.fields ?? []), field],
            },
          },
        }));
        return field.id;
      },

      updateTrackingField(fieldId, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: (s.project.partTracking?.fields ?? []).map(f =>
                f.id === fieldId ? { ...f, ...updates } : f
              ),
            },
          },
        }));
      },

      deleteTrackingField(fieldId) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: (s.project.partTracking?.fields ?? []).filter(f => f.id !== fieldId),
            },
          },
        }));
      },

      reorderTrackingFields(fromIdx, toIdx) {
        get()._pushHistory();
        set(s => {
          const fields = [...(s.project.partTracking?.fields ?? [])];
          const [moved] = fields.splice(fromIdx, 1);
          fields.splice(toIdx, 0, moved);
          return {
            project: {
              ...s.project,
              partTracking: { ...s.project.partTracking, fields },
            },
          };
        });
      },

      // ── Signal actions (unified: replaces referencePositions + smOutputs) ──
      addSignal(data) {
        get()._pushHistory();
        const signal = { id: uid(), name: 'NewSignal', description: '', type: 'position', axes: [], ...data };
        set(s => ({
          project: {
            ...s.project,
            signals: [...(s.project.signals ?? []), signal],
          },
        }));
        return signal.id;
      },

      updateSignal(id, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            signals: (s.project.signals ?? []).map(sig =>
              sig.id === id ? { ...sig, ...updates } : sig
            ),
          },
        }));
      },

      deleteSignal(id) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            signals: (s.project.signals ?? []).filter(sig => sig.id !== id),
          },
        }));
      },

      // ── Legacy SM Output actions (kept for backward compat with existing data) ──
      addSmOutput(smId, data) {
        get()._pushHistory();
        const output = { id: uid(), name: 'NewOutput', description: '', activeNodeId: null, ...data };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: [...(sm.smOutputs ?? []), output] }
                : sm
            )),
        }));
        return output.id;
      },

      updateSmOutput(smId, id, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: (sm.smOutputs ?? []).map(o => o.id === id ? { ...o, ...updates } : o) }
                : sm
            )),
        }));
      },

      deleteSmOutput(smId, id) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: (sm.smOutputs ?? []).filter(o => o.id !== id) }
                : sm
            )),
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

      // ── Inline picker control ───────────────────────────────────────────
      setOpenPickerOnNode(nodeId) {
        set({ openPickerOnNodeId: nodeId });
      },
      clearOpenPickerOnNode() {
        set({ openPickerOnNodeId: null });
      },

      // ── Verify helpers (auto-create / manage verify devices) ────────────

      /** Find or create an auto-verify CheckResults device for a given node. */
      findOrCreateVerifyDevice(smId, nodeId) {
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const node = sm.nodes.find(n => n.id === nodeId);
        if (!node) return null;

        // Look for existing auto-verify device already linked to this node via an action
        const existingAction = (node.data?.actions ?? []).find(a => {
          const dev = sm.devices.find(d => d.id === a.deviceId);
          return dev?.type === 'CheckResults' && dev._autoVerify;
        });
        if (existingAction) {
          return sm.devices.find(d => d.id === existingAction.deviceId);
        }

        // Create new hidden CheckResults device
        const existingCount = (sm.devices ?? []).filter(d => d.type === 'CheckResults' && d._autoVerify).length;
        const num = existingCount + 1;
        const deviceId = get().addDevice(smId, {
          type: 'CheckResults',
          displayName: `Verify ${num}`,
          name: `Verify${num}`,
          _autoVerify: true,
          _sourceNodeId: nodeId,
          outcomes: [],
        });
        const freshSm = _getSmArray(get()).find(s => s.id === smId);
        return freshSm?.devices?.find(d => d.id === deviceId) ?? null;
      },

      /** Add a verify condition to a node's auto-verify device. */
      addVerifyCondition(smId, nodeId, inputRef, condition, label) {
        const device = get().findOrCreateVerifyDevice(smId, nodeId);
        if (!device) return null;

        const outcomeId = `out_${Date.now()}`;
        const newOutcome = {
          id: outcomeId,
          inputRef,
          condition,
          label: label || '',
          retry: false,
          maxRetries: 3,
          faultStep: 137,
        };

        const updatedOutcomes = [...(device.outcomes ?? []), newOutcome];
        get().updateDevice(smId, device.id, { outcomes: updatedOutcomes });

        // Ensure the node has a Check action for this device
        const sm = _getSmArray(get()).find(s => s.id === smId);
        const node = sm?.nodes?.find(n => n.id === nodeId);
        const hasAction = (node?.data?.actions ?? []).some(a => a.deviceId === device.id);
        if (!hasAction) {
          get().addAction(smId, nodeId, { deviceId: device.id, operation: 'Check' });
        }

        // If we just went from 1→2 outcomes, retroactively update existing edges
        if (updatedOutcomes.length === 2) {
          const freshSm = _getSmArray(get()).find(s => s.id === smId);
          const existingEdges = (freshSm?.edges ?? []).filter(e => e.source === nodeId);
          for (const edge of existingEdges) {
            if (edge.data?.conditionType === 'verify' || (edge.data?.conditionType !== 'checkResult' && edge.data?.conditionType !== 'ready')) {
              get().updateEdge(smId, edge.id, {
                conditionType: 'checkResult',
                deviceId: device.id,
                outcomeId: updatedOutcomes[0].id,
                outcomeLabel: updatedOutcomes[0].label,
                outcomeIndex: 0,
                label: updatedOutcomes[0].label || 'Branch 1',
                inputRef: updatedOutcomes[0].inputRef,
                condition: updatedOutcomes[0].condition,
              });
              break;
            }
          }
        }

        return { deviceId: device.id, outcomeId };
      },

      /** Remove a verify condition from a node's auto-verify device. */
      removeVerifyCondition(smId, nodeId, outcomeId) {
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const node = sm.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const verifyAction = (node.data?.actions ?? []).find(a => {
          const dev = sm.devices.find(d => d.id === a.deviceId);
          return dev?.type === 'CheckResults' && dev._autoVerify;
        });
        if (!verifyAction) return;

        const device = sm.devices.find(d => d.id === verifyAction.deviceId);
        if (!device) return;

        const updatedOutcomes = (device.outcomes ?? []).filter(o => o.id !== outcomeId);

        if (updatedOutcomes.length === 0) {
          // Remove action and device entirely
          get().deleteAction(smId, nodeId, verifyAction.id);
          get().deleteDevice(smId, device.id);
        } else {
          get().updateDevice(smId, device.id, { outcomes: updatedOutcomes });

          // 2→1: convert remaining checkResult edges back to verify
          if (updatedOutcomes.length === 1) {
            const freshSm = _getSmArray(get()).find(s => s.id === smId);
            const existingEdges = (freshSm?.edges ?? []).filter(e => e.source === nodeId);
            for (const edge of existingEdges) {
              if (edge.data?.conditionType === 'checkResult' && edge.data?.deviceId === device.id) {
                if (edge.data.outcomeId === updatedOutcomes[0].id) {
                  get().updateEdge(smId, edge.id, {
                    conditionType: 'verify',
                    label: updatedOutcomes[0].label || 'Verify',
                  });
                } else {
                  // Orphaned edge — clear its condition
                  get().updateEdge(smId, edge.id, {
                    conditionType: 'ready',
                    label: 'Ready',
                  });
                }
              }
            }
          }
        }
      },

      // ── Duplicate node ──────────────────────────────────────────────────
      duplicateNode(smId, nodeId) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const sourceNode = sm.nodes.find(n => n.id === nodeId);
        if (!sourceNode) return null;

        const newId = uid();
        const newNode = {
          ...sourceNode,
          id: newId,
          position: {
            x: sourceNode.position.x + 50,
            y: sourceNode.position.y + 80,
          },
          data: {
            ...sourceNode.data,
            stepNumber: sm.nodes.length,
            isInitial: false,
            label: `${sourceNode.data.label} (copy)`,
            actions: sourceNode.data.actions.map(a => ({ ...a, id: uid() })),
          },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
              sm2.id === smId ? { ...sm2, nodes: [...sm2.nodes, newNode] } : sm2
            )),
          selectedNodeId: newId,
          selectedEdgeId: null,
        }));
        return newId;
      },

      /** Generic node update — merges top-level fields and data sub-fields. */
      updateNode(smId, nodeId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, ...updates, data: { ...n.data, ...(updates.data || {}) } }
                        : n
                    ),
                  }
                : sm
            )),
        }));
      },

      /**
       * Replace a state node with a decision node at the same position.
       * Rewires all incoming edges that pointed at the old node to the new decision node.
       * The old node is removed.
       */
      replaceNodeWithDecision(smId, oldNodeId, decisionData) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const oldNode = sm.nodes.find(n => n.id === oldNodeId);
        if (!oldNode) return null;

        const newId = decisionData.id ?? `id_${(Date.now()).toString(36)}`;
        // Center decision node horizontally under the old node
        // StateNode renders at ~300px wide; DecisionNode is 240px
        const srcWidth = oldNode.measured?.width ?? oldNode.width ?? 240;
        const decWidth = 240;
        const centeredPosition = {
          x: oldNode.position.x + (srcWidth - decWidth) / 2,
          y: oldNode.position.y,
        };
        const newNode = {
          id: newId,
          type: 'decisionNode',
          position: centeredPosition,
          data: {
            label: 'Decision',
            decisionType: 'signal',
            exitCount: 2,
            exit1Label: 'Pass',
            exit2Label: 'Fail',
            updatePartTracking: false,
            ...decisionData,
          },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 => {
              if (sm2.id !== smId) return sm2;
              const nodes = sm2.nodes
                .filter(n => n.id !== oldNodeId)
                .concat(newNode);
              const edges = sm2.edges.map(e =>
                e.target === oldNodeId
                  ? { ...e, target: newId, targetHandle: 'input' }
                  : e
              ).filter(e => e.source !== oldNodeId); // remove outgoing edges from old node
              return { ...sm2, nodes, edges };
            })),
          selectedNodeId: newId,
          selectedEdgeId: null,
        }));
        return newId;
      },

      // ── Recipe Management ──────────────────────────────────────────────

      openRecipeManager()  { set({ showRecipeManager: true }); },
      closeRecipeManager() { set({ showRecipeManager: false }); },

      setActiveRecipe(recipeId) {
        set({ activeRecipeId: recipeId });
      },

      addRecipe({ name, description = '', customSequence = false }) {
        get()._pushHistory();
        const id = uid();
        const recipes = [...(get().project.recipes ?? [])];
        const isDefault = recipes.length === 0;
        recipes.push({ id, name, description, isDefault, customSequence });
        const overrides = { ...(get().project.recipeOverrides ?? {}), [id]: { positions: {}, timers: {}, speeds: {}, skippedNodes: {} } };
        set(s => ({
          project: { ...s.project, recipes, recipeOverrides: overrides },
          activeRecipeId: s.activeRecipeId ?? id,
        }));
        return id;
      },

      updateRecipe(recipeId, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            recipes: (s.project.recipes ?? []).map(r =>
              r.id === recipeId ? { ...r, ...updates } : r
            ),
          },
        }));
      },

      deleteRecipe(recipeId) {
        get()._pushHistory();
        const recipes = (get().project.recipes ?? []).filter(r => r.id !== recipeId);
        const overrides = { ...(get().project.recipeOverrides ?? {}) };
        delete overrides[recipeId];
        // If deleted recipe was default, make first remaining the default
        if (recipes.length > 0 && !recipes.some(r => r.isDefault)) {
          recipes[0].isDefault = true;
        }
        set(s => ({
          project: { ...s.project, recipes, recipeOverrides: overrides },
          activeRecipeId: s.activeRecipeId === recipeId
            ? (recipes[0]?.id ?? null)
            : s.activeRecipeId,
        }));
      },

      duplicateRecipe(recipeId, newName) {
        get()._pushHistory();
        const id = uid();
        const source = (get().project.recipes ?? []).find(r => r.id === recipeId);
        if (!source) return null;
        const sourceOverrides = (get().project.recipeOverrides ?? {})[recipeId] ?? {};
        const recipes = [...(get().project.recipes ?? []), {
          id, name: newName, description: source.description, isDefault: false, customSequence: source.customSequence,
        }];
        const overrides = {
          ...(get().project.recipeOverrides ?? {}),
          [id]: JSON.parse(JSON.stringify(sourceOverrides)),
        };
        set(s => ({ project: { ...s.project, recipes, recipeOverrides: overrides } }));
        return id;
      },

      setDefaultRecipe(recipeId) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            recipes: (s.project.recipes ?? []).map(r => ({
              ...r, isDefault: r.id === recipeId,
            })),
          },
        }));
      },

      /** Toggle custom sequence for a recipe. Copies or discards SM data. */
      toggleCustomSequence(recipeId) {
        get()._pushHistory();
        const { project } = get();
        const recipe = (project.recipes ?? []).find(r => r.id === recipeId);
        if (!recipe) return;

        const newCustom = !recipe.customSequence;
        const overrides = { ...(project.recipeOverrides ?? {}) };
        const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };

        if (newCustom) {
          // Deep-copy all SMs into customSMs so this recipe gets its own sequence
          recipeOv.customSMs = JSON.parse(JSON.stringify(project.stateMachines));
        } else {
          // Discard custom SMs — revert to base sequence
          delete recipeOv.customSMs;
        }

        overrides[recipeId] = recipeOv;
        const recipes = (project.recipes ?? []).map(r =>
          r.id === recipeId ? { ...r, customSequence: newCustom, sequenceVariantId: null } : r
        );
        set({ project: { ...project, recipes, recipeOverrides: overrides } });
      },

      /** Create a named sequence variant (deep-copies base SMs). */
      createSequenceVariant(name) {
        get()._pushHistory();
        const { project } = get();
        const id = uid();
        const variant = {
          id,
          name,
          stateMachines: JSON.parse(JSON.stringify(project.stateMachines)),
        };
        set({ project: { ...project, sequenceVariants: [...(project.sequenceVariants ?? []), variant] } });
        return id;
      },

      /** Delete a sequence variant and unlink any recipes that used it. */
      deleteSequenceVariant(variantId) {
        get()._pushHistory();
        const { project } = get();
        const variants = (project.sequenceVariants ?? []).filter(v => v.id !== variantId);
        const recipes = (project.recipes ?? []).map(r =>
          r.sequenceVariantId === variantId ? { ...r, sequenceVariantId: null, customSequence: false } : r
        );
        set({ project: { ...project, sequenceVariants: variants, recipes } });
      },

      /** Rename a sequence variant. */
      renameSequenceVariant(variantId, name) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            sequenceVariants: (s.project.sequenceVariants ?? []).map(v =>
              v.id === variantId ? { ...v, name } : v
            ),
          },
        }));
      },

      /** Assign a recipe to a named sequence variant (or null for base). */
      setRecipeSequenceVariant(recipeId, variantId) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            recipes: (s.project.recipes ?? []).map(r =>
              r.id === recipeId ? { ...r, sequenceVariantId: variantId || null, customSequence: !!variantId } : r
            ),
          },
        }));
      },

      // Recipe override mutations
      setRecipeOverride(recipeId, category, key, value) {
        get()._pushHistory();
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          recipeOv[category] = { ...recipeOv[category], [key]: value };
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      clearRecipeOverride(recipeId, category, key) {
        get()._pushHistory();
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          const catObj = { ...recipeOv[category] };
          delete catObj[key];
          recipeOv[category] = catObj;
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      toggleNodeSkip(recipeId, smId, nodeId) {
        get()._pushHistory();
        const key = `${smId}:${nodeId}`;
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          const skipped = { ...recipeOv.skippedNodes };
          if (skipped[key]) delete skipped[key];
          else skipped[key] = true;
          recipeOv.skippedNodes = skipped;
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      /** Check if a node is skipped in the currently active recipe */
      isNodeSkipped(smId, nodeId) {
        const { activeRecipeId, project } = get();
        if (!activeRecipeId) return false;
        const key = `${smId}:${nodeId}`;
        return !!(project.recipeOverrides?.[activeRecipeId]?.skippedNodes?.[key]);
      },

      /** Get effective value for a parameter (active recipe override or device default) */
      getEffectiveValue(category, key, defaultValue) {
        const { activeRecipeId, project } = get();
        if (!activeRecipeId) return defaultValue;
        const val = project.recipeOverrides?.[activeRecipeId]?.[category]?.[key];
        return val !== undefined ? val : defaultValue;
      },

      // ── Multi-project management ──────────────────────────────────────

      openProjectManager()  { set({ showProjectManager: true }); },
      closeProjectManager() { set({ showProjectManager: false }); },

      /** Save current project to its file on the server. */
      async saveCurrentProject() {
        let { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) return;
        // If no filename yet, derive one from the project name and persist it
        if (!currentFilename) {
          currentFilename = projectApi.toFilename(project.name || 'New Project');
          set({ currentFilename });
        }
        try {
          // Persist the last-active SM so we can restore it when switching back
          const dataToSave = { ...project, _lastActiveSmId: activeSmId };
          await projectApi.saveProject(currentFilename, dataToSave);
        } catch (err) {
          console.error('Auto-save failed:', err);
        }
      },

      /** Switch to a different project. Saves current first. */
      async switchProject(filename) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) return;

        // Save current project before switching (preserves last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before switch failed:', err);
          }
        }

        // Load target project
        try {
          const loaded = await projectApi.loadProject(filename);
          // Restore the last-active SM tab (or fall back to the first SM)
          const restoredSmId = loaded._lastActiveSmId;
          const validSmId = (loaded.stateMachines ?? []).some(sm => sm.id === restoredSmId)
            ? restoredSmId
            : loaded.stateMachines?.[0]?.id ?? null;
          set({
            project: loaded,
            currentFilename: filename,
            activeSmId: validSmId,
            selectedNodeId: null,
            selectedEdgeId: null,
            showProjectManager: false,
          });
        } catch (err) {
          alert(`Failed to load project: ${err.message}`);
        }
      },

      /** Create a brand new project and switch to it. */
      async createNewProject(name) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) {
          alert('Project server is not running.\n\nMake sure you launched the app with START_APP.bat\n(it starts both the API server and the dev server).');
          return;
        }

        const filename = projectApi.toFilename(name);

        // Check if a project with this name already exists
        try {
          const existing = await projectApi.listProjects();
          const match = existing.find(p => p.filename === filename);
          if (match) {
            const openExisting = confirm(
              `A project named "${name}" already exists.\n\nClick OK to open it, or Cancel to pick a different name.`
            );
            if (openExisting) {
              await get().switchProject(filename);
            }
            return; // Don't create a duplicate either way
          }
        } catch { /* ignore — proceed with create */ }

        // Save current project first (preserve last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before create failed:', err);
          }
        }

        const newProject = { name: name || 'New Project', stateMachines: [], partTracking: { fields: [] }, signals: [] };

        try {
          await projectApi.saveProject(filename, newProject);
          set({
            project: newProject,
            currentFilename: filename,
            activeSmId: null,
            selectedNodeId: null,
            selectedEdgeId: null,
            showProjectManager: false,
            showNewSmModal: true,    // Auto-open "New SM" modal so user isn't on a blank canvas
          });
        } catch (err) {
          alert(`Failed to create project: ${err.message}`);
        }
      },

      /** Delete a project from the server. Switches away if it's the current one. */
      async deleteProjectFile(filename) {
        const { currentFilename, serverAvailable } = get();
        if (!serverAvailable) return;

        try {
          await projectApi.deleteProjectFile(filename);
        } catch (err) {
          alert(`Failed to delete: ${err.message}`);
          return;
        }

        // If we deleted the active project, switch to another
        if (filename === currentFilename) {
          try {
            const remaining = await projectApi.listProjects();
            if (remaining.length > 0) {
              await get().switchProject(remaining[0].filename);
            } else {
              await get().createNewProject('New Project');
            }
          } catch (err) {
            console.error('Switch after delete failed:', err);
          }
        }
      },

      /** Rename a project (save with new filename, delete old). */
      async renameProject(oldFilename, newName) {
        const { currentFilename, serverAvailable } = get();
        if (!serverAvailable) return;

        const newFilename = projectApi.toFilename(newName);
        if (newFilename === oldFilename) {
          // Same filename — just update the name inside the file
          if (oldFilename === currentFilename) {
            set(s => ({ project: { ...s.project, name: newName } }));
            await get().saveCurrentProject();
          } else {
            try {
              const data = await projectApi.loadProject(oldFilename);
              data.name = newName;
              await projectApi.saveProject(oldFilename, data);
            } catch (err) {
              console.error('Rename failed:', err);
            }
          }
          return;
        }

        try {
          // Load old, save as new, delete old
          let data;
          if (oldFilename === currentFilename) {
            data = { ...get().project, name: newName };
          } else {
            data = await projectApi.loadProject(oldFilename);
            data.name = newName;
          }

          await projectApi.saveProject(newFilename, data);
          await projectApi.deleteProjectFile(oldFilename);

          if (oldFilename === currentFilename) {
            set({ currentFilename: newFilename, project: data });
          }
        } catch (err) {
          alert(`Failed to rename: ${err.message}`);
        }
      },

      /** Import a JSON project as a new file on the server, then switch to it. */
      async importProject(projectData) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) {
          // Fallback: just load into memory (old behavior)
          get().loadProject(projectData);
          return;
        }

        // Save current project first (preserve last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before import failed:', err);
          }
        }

        // Use the project's name as the filename — overwrite if it exists
        const filename = projectApi.toFilename(projectData.name || 'Imported');

        try {
          await projectApi.saveProject(filename, projectData);
          const restoredSmId = projectData._lastActiveSmId;
          const validSmId = (projectData.stateMachines ?? []).some(sm => sm.id === restoredSmId)
            ? restoredSmId
            : projectData.stateMachines?.[0]?.id ?? null;
          set({
            project: projectData,
            currentFilename: filename,
            activeSmId: validSmId,
            selectedNodeId: null,
            selectedEdgeId: null,
          });
        } catch (err) {
          alert(`Failed to import: ${err.message}`);
        }
      },

      /** Bootstrap: detect server, load or create initial project. */
      async initializeProjects() {
        const available = await projectApi.isServerAvailable();
        set({ serverAvailable: available });
        if (!available) return;

        /** Preserve current activeSmId if valid, else restore from saved, else first SM. */
        function pickActiveSmId(data) {
          const sms = data.stateMachines ?? [];
          // Prefer the activeSmId already in memory (from localStorage persist)
          const current = get().activeSmId;
          if (current && sms.some(sm => sm.id === current)) return current;
          // Fall back to _lastActiveSmId saved in project file
          const restored = data._lastActiveSmId;
          if (restored && sms.some(sm => sm.id === restored)) return restored;
          return sms[0]?.id ?? null;
        }

        try {
          const projects = await projectApi.listProjects();

          // If we already have a currentFilename from localStorage, try loading it
          const { currentFilename } = get();
          if (currentFilename) {
            const exists = projects.find(p => p.filename === currentFilename);
            if (exists) {
              const data = await projectApi.loadProject(currentFilename);
              set({
                project: data,
                activeSmId: pickActiveSmId(data),
              });
              return;
            }
          }

          // Otherwise load the most recent project, or create a default
          if (projects.length > 0) {
            projects.sort((a, b) => b.lastModified - a.lastModified);
            const latest = projects[0];
            const data = await projectApi.loadProject(latest.filename);
            set({
              project: data,
              currentFilename: latest.filename,
              activeSmId: pickActiveSmId(data),
            });
          } else {
            // No projects exist — save the current in-memory project (might be from localStorage)
            const { project } = get();
            const filename = projectApi.toFilename(project.name || 'New Project');
            await projectApi.saveProject(filename, project);
            set({ currentFilename: filename });
          }
          // One-time cleanup: remove duplicate auto-vision params from earlier bug
          get().deduplicateAutoVisionParams();

          // Auto-generate indexer SM for indexing machines if it doesn't exist yet
          const mcType = get().project?.machineConfig?.machineType;
          if (mcType === 'indexing' || mcType === 'linear') {
            get().autoGenerateIndexerSM();
          }
        } catch (err) {
          console.error('Project initialization failed:', err);
        }
      },
    }),
    {
      name: 'sdc-state-logic-v1',
      // Only persist the project data, not UI state
      partialize: (state) => ({
        project: state.project,
        activeSmId: state.activeSmId,
        activeRecipeId: state.activeRecipeId,
        currentFilename: state.currentFilename,
      }),
      // Migration: strip legacy _autoVision params on rehydrate, add new fields
      onRehydrateStorage: () => (state) => {
        if (state?.project) {
          // Migrate referencePositions → signals on rehydrate
          if (!state.project.signals) {
            state.project.signals = [];
            for (const rp of (state.project.referencePositions ?? [])) {
              state.project.signals.push({
                id: rp.id,
                name: rp.name,
                description: rp.description ?? '',
                type: 'position',
                axes: (rp.axes ?? []).map(a => ({
                  smId: a.smId,
                  deviceId: a.axisDeviceId,
                  deviceName: a.axisDeviceId,
                  positionName: a.positionName,
                  tolerance: a.tolerance,
                })),
              });
            }
            for (const sm of (state.project.stateMachines ?? [])) {
              for (const o of (sm.smOutputs ?? [])) {
                state.project.signals.push({
                  id: o.id,
                  name: o.name,
                  description: o.description ?? '',
                  type: 'state',
                  smId: sm.id,
                  stateNodeId: o.activeNodeId ?? null,
                  stateName: o.name,
                });
              }
            }
          }
          delete state.project.referencePositions;
          if (state.project.stateMachines) {
            for (const sm of state.project.stateMachines) {
              if (sm.devices) {
                sm.devices = sm.devices.filter(d => !d._autoVision);
              }
              if (!sm.smOutputs) sm.smOutputs = [];

              // Migrate old vision nodes: add visionExitMode if missing
              for (const node of (sm.nodes ?? [])) {
                const d = node.data ?? {};
                const actions = d.actions ?? [];
                const hasVision = actions.some(a => {
                  const dev = (sm.devices ?? []).find(dv => dv.id === a.deviceId);
                  return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
                });
                if (hasVision && !d.visionExitMode) {
                  // Check if this node already has side-exit edges
                  const edges = sm.edges ?? [];
                  const hasPassEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-pass');
                  const hasFailEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-fail');
                  const hasSingleEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-single');
                  if (hasPassEdge && hasFailEdge) {
                    node.data.visionExitMode = '2-node';
                  } else if (hasSingleEdge) {
                    node.data.visionExitMode = '1-node';
                  }
                  // If no exit edges exist yet, leave visionExitMode unset — user picks on Done
                }
              }

              // Migrate: ensure all ServoAxis devices have Slow + Fast speed profiles
              for (const dev of (sm.devices ?? [])) {
                if (dev.type === 'ServoAxis') {
                  if (!dev.speedProfiles) dev.speedProfiles = [];
                  if (!dev.speedProfiles.find(p => p.name === 'Slow')) {
                    dev.speedProfiles.push({ name: 'Slow', speed: 100, accel: 1000, decel: 1000 });
                  }
                  if (!dev.speedProfiles.find(p => p.name === 'Fast')) {
                    dev.speedProfiles.push({ name: 'Fast', speed: 2500, accel: 25000, decel: 25000 });
                  }
                }
              }

              // Ensure recipes array exists
              if (!state.project.recipes) state.project.recipes = [];
            }
          }
        }
      },
    }
  )
  )
);

// ── Debounced auto-save to server ──────────────────────────────────────────
// Writes project to the server file whenever project data changes (debounced 2s).
// This prevents the "reload loses SMs" bug where initializeProjects loads stale
// server data over fresh localStorage data.
let _autoSaveTimer = null;
useDiagramStore.subscribe(
  (state) => state.project,
  (project) => {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(async () => {
      const { serverAvailable, currentFilename } = useDiagramStore.getState();
      if (!serverAvailable || !currentFilename) return;
      try {
        await projectApi.saveProject(currentFilename, project);
      } catch (err) {
        console.warn('Auto-save failed:', err.message);
      }
    }, 2000);
  }
);
