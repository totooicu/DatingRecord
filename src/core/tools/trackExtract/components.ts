// ③ 连通域：8-邻接洪水填充，顺便记下每块的面积与 bbox。

export interface Component {
  label: number;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let seed = 0; seed < w * h; seed++) {
    if (!mask[seed] || labels[seed] !== -1) continue;
    const label = comps.length;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = label;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const px = p % w;
      const py = (p - px) / w;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      // 8-邻接
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = ny * w + nx;
          if (mask[ni] && labels[ni] === -1) {
            labels[ni] = label;
            stack[sp++] = ni;
          }
        }
      }
    }
    comps.push({ label, area, x0, y0, x1, y1 });
  }
  return { labels, comps };
}
