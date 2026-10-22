import { memo } from 'react';
import { MiniMap, type MiniMapNodeProps } from '@xyflow/react';
import { useMediaUrl } from './media';
import { currentOutput, useCanvas } from './store';

// Overview of the whole canvas: image and video nodes as their thumbnails, everything else as
// a block in its type colour, and a frame for the visible area that can be dragged or clicked.

const COLORS: Record<string, string> = {
  text: '#5b6170', script: '#6d8bff', vprompt: '#8f6dff', image: '#3fa7a0', video: '#c0713f', audio: '#b0549c', voice: '#d0568a',
  director: '#4f8ef7', style: '#7aa83f', lens: '#a35fd6', method: '#e0a83a', character: '#d9785b', reference: '#8c7a3c', group: '#26262c',
};

const MiniNode = memo(function MiniNode({ id, x, y, width, height, selected }: MiniMapNodeProps) {
  const node = useCanvas((s) => s.nodes.find((n) => n.id === id));
  const media = node ? currentOutput(node.data)?.media : undefined;
  const still = media?.kind === 'image' ? media : media?.kind === 'video' ? media.poster : undefined;
  const url = useMediaUrl(still?.id);
  const color = COLORS[node?.type ?? ''] ?? '#3a3a42';
  const r = Math.min(12, width / 8, height / 8);
  const clip = `mm-${id}`;
  return (
    <g>
      <clipPath id={clip}>
        <rect x={x} y={y} width={width} height={height} rx={r} />
      </clipPath>
      <rect x={x} y={y} width={width} height={height} rx={r} fill={color} opacity={node?.type === 'group' ? 0.5 : 0.9} />
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
      maskColor="rgba(8, 8, 10, 0.62)"
      maskStrokeColor="rgba(109, 139, 255, 0.9)"
      maskStrokeWidth={2}
      style={{ width: 240, height: 160 }}
      ariaLabel="画布小地图"
    />
  );
}
