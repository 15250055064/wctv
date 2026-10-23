import { memo } from 'react';
import { MiniMap, type MiniMapNodeProps } from '@xyflow/react';
import { useMediaUrl } from './media';
import { currentOutput, useCanvas } from './store';

// Overview of the whole canvas, styled after LibTV's: small, quiet grey blocks (image and video
// nodes show their thumbnails) and a thin frame for the visible area, which can be dragged.

const MiniNode = memo(function MiniNode({ id, x, y, width, height, selected }: MiniMapNodeProps) {
  const node = useCanvas((s) => s.nodes.find((n) => n.id === id));
  const media = node ? currentOutput(node.data)?.media : undefined;
  const still = media?.kind === 'image' ? media : media?.kind === 'video' ? media.poster : undefined;
  const url = useMediaUrl(still?.id);
  const group = node?.type === 'group';
  const r = Math.min(16, width / 8, height / 8);
  const clip = `mm-${id}`;
  return (
    <g>
      <clipPath id={clip}>
        <rect x={x} y={y} width={width} height={height} rx={r} />
      </clipPath>
      <rect x={x} y={y} width={width} height={height} rx={r} fill={group ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.28)'} />
      {url && <image href={url} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />}
      {selected && <rect x={x} y={y} width={width} height={height} rx={r} fill="none" stroke="#6d8bff" strokeWidth={Math.max(6, width / 40)} />}
    </g>
  );
});

export function CanvasMiniMap() {
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-left"
      className="minimap"
      nodeComponent={MiniNode}
      maskColor="rgba(0, 0, 0, 0.18)"
      maskStrokeColor="rgba(255, 255, 255, 0.55)"
      maskStrokeWidth={1.5}
      style={{ width: 168, height: 112 }}
      ariaLabel="画布小地图"
    />
  );
}
