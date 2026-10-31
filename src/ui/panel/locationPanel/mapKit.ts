// 定位面板里所有「跟 Leaflet 打交道」的画图工具。
//
// 从 LocationPanel.tsx 分出来：这些函数只负责把点位/箭头变成 Leaflet 的图标和样式，
// 不认识面板的任何状态。分开之后，面板本体少掉一堆 L.divIcon 的模板字符串，
// 想改地图上的视觉只要看这一个文件。

import L from 'leaflet';
import type { LocationPoint } from '../../../core/location/format';
import {
  ARROW_MAX,
  ARROW_SIZE,
  COLOR_HIST_POINT,
  COLOR_PLAY,
  COLOR_POINT_FILL,
  COLOR_POINT_RING,
  COLOR_SELECTED,
  CURRENT_SIZE,
  DOT_RADIUS,
  HIST_RADIUS,
} from './model';

/**
 * 记录点样式：
 *   选中 —— 放大两倍、白边红芯；
 *   最新 —— 与线同粗，白芯深边（刚打的那个点一眼能看到）；
 *   历史 —— 线宽一半的小墨点。
 */
export function pointStyle(selected: boolean, latest: boolean): L.CircleMarkerOptions {
  if (selected) {
    return { radius: DOT_RADIUS * 2, color: '#ffffff', weight: 2, fillColor: COLOR_SELECTED, fillOpacity: 1 };
  }
  if (latest) {
    return {
      radius: DOT_RADIUS,
      color: COLOR_POINT_RING,
      weight: 1.2,
      fillColor: COLOR_POINT_FILL,
      fillOpacity: 1,
    };
  }
  // 2px 的淡墨点：只让线有一点「这里采过一个点」的质感，别把线串成珠子
  return { radius: HIST_RADIUS, color: COLOR_HIST_POINT, weight: 0, fillColor: COLOR_HIST_POINT, fillOpacity: 1 };
}

/** 当前位置那个圆点。size 只在建图标时用一次，之后靠 setLatLng 移动。 */
export function dotIcon(color: string, size = CURRENT_SIZE): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="loc-pin" style="width:${size}px;height:${size}px;border-radius:50%;background:${color};box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * 回放播放头：白边圆点 + 一圈扩散的脉冲环。
 * 图标只在第一次建的时候换，之后每帧只 setLatLng —— 如果每次移动都 setIcon，
 * 环的动画会从头重启，看着就是一闪一闪的卡顿而不是平稳地跟着走。
 */
export function playIcon(): L.DivIcon {
  const size = 16;
  return L.divIcon({
    className: '',
    html: `<div class="loc-playhead" style="--loc-play:${COLOR_PLAY}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** a→b 的方位角（度）：0 = 正北，90 = 正东；箭头图标默认尖朝北，照这个角旋转 */
export function bearingDeg(a: LocationPoint, b: LocationPoint): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** 沿线放方向箭头：不引插件，每隔几段在段中点放一个旋转三角（不拦点击） */
export function addArrows(layer: L.LayerGroup, pts: LocationPoint[]): void {
  const segCount = pts.length - 1;
  if (segCount < 1) return;
  const step = Math.max(1, Math.ceil(segCount / ARROW_MAX));
  for (let i = 0; i < segCount; i += step) {
    const a = pts[i];
    const b = pts[i + 1];
    const icon = L.divIcon({
      className: '',
      html: `<div class="loc-arrow" style="transform: rotate(${bearingDeg(a, b).toFixed(1)}deg)"></div>`,
      iconSize: [ARROW_SIZE, ARROW_SIZE],
      iconAnchor: [ARROW_SIZE / 2, ARROW_SIZE / 2],
    });
    L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { icon, interactive: false }).addTo(layer);
  }
}
