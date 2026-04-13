/**
 * Canvas - React Flow diagram editor for state logic diagrams.
 */

import { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { StateNode } from './nodes/StateNode.jsx';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { buildTransitionLabel } from '../lib/tagNaming.js';

const nodeTypes = { stateNode: StateNode };

export function Canvas() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const reactFlowWrapper = useRef(null);

  const onNodesChange = useCallback((changes) => {
    if (!sm) return;
    store.onNodesChange(sm.id, changes);
  }, [sm, store]);

  const onEdgesChange = useCallback((changes) => {
    if (!sm) return;
    store.onEdgesChange(sm.id, changes);
  }, [sm, store]);

  const onConnect = useCallback((connection) => {
    if (!sm) return;
    // When user draws an edge, open transition condition modal
    const edgeId = store.addEdge(sm.id, connection, {
      conditionType: 'trigger',
      label: 'Trigger',
    });
    store.setSelectedEdge(edgeId);
    store.openTransitionModal(edgeId);
  }, [sm, store]);

  const onNodeClick = useCallback((event, node) => {
    store.setSelectedNode(node.id);
  }, [store]);

  const onEdgeClick = useCallback((event, edge) => {
    store.setSelectedEdge(edge.id);
  }, [store]);

  const onEdgeDoubleClick = useCallback((event, edge) => {
    store.setSelectedEdge(edge.id);
    store.openTransitionModal(edge.id);
  }, [store]);

  const onPaneClick = useCallback(() => {
    store.clearSelection();
  }, [store]);

  // Drop from sidebar
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (!sm) return;

    const label = event.dataTransfer.getData('application/state-node-label');
    if (!label && event.dataTransfer.getData('application/state-node') !== 'true') return;

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    store.addNode(sm.id, {
      position,
      label: label || undefined,
    });
  }, [sm, store, screenToFlowPosition]);

  if (!sm) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty__content">
          <div className="canvas-empty__icon">⚡</div>
          <h2>No State Machine Selected</h2>
          <p>Create a new state machine to begin building your sequence logic.</p>
          <button className="btn btn--primary btn--lg" onClick={store.openNewSmModal}>
            + New State Machine
          </button>
        </div>
      </div>
    );
  }

  const nodes = sm.nodes ?? [];
  const edges = sm.edges ?? [];

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
          labelStyle: { fill: '#374151', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
          labelBgPadding: [4, 3],
          labelBgBorderRadius: 4,
        }}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d1d5db" />
        <Controls
          style={{ bottom: 16, left: 16 }}
          showInteractive={false}
        />
        <MiniMap
          style={{ bottom: 16, right: 16 }}
          nodeColor={(n) => {
            if (n.data?.isInitial) return '#10b981';
            return '#3b82f6';
          }}
          maskColor="rgba(255,255,255,0.7)"
        />

        {/* Floating add button */}
        <div className="canvas-add-btn" title="Add State (or drag from sidebar)">
          <button
            className="btn btn--circle btn--primary"
            onClick={() => store.addNode(sm.id)}
            title="Add new state step"
          >
            +
          </button>
        </div>
      </ReactFlow>
    </div>
  );
}
