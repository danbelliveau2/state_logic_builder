/**
 * useReactFlowZoomScale — returns a style object that scales a fixed-position
 * popup/portal to match the current React Flow canvas zoom level.
 *
 * Usage:
 *   const zoomStyle = useReactFlowZoomScale();
 *   <div style={{ position: 'fixed', top, left, ...zoomStyle }}>...</div>
 *
 * The popup is positioned in screen coordinates (already post-zoom), and the
 * scale is applied from the top-left so the popup grows rightward/downward
 * from the anchor point.
 *
 * Subscribes via zustand `useStore` so the scale updates live as the user
 * zooms the canvas — you don't need to re-open the popup.
 */

import { useStore } from '@xyflow/react';

export function useReactFlowZoomScale(origin = 'top left') {
  // transform = [x, y, zoom]
  const zoom = useStore(s => s.transform?.[2] ?? 1);
  // Clamp: under ~0.6 the popups become unreadable; over ~2.5 they overflow
  const z = Math.max(0.6, Math.min(2.5, zoom));
  return {
    transform: `scale(${z})`,
    transformOrigin: origin,
  };
}
