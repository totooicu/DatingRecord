// 「功能体验 → 边缘分割」独立子页。
//
// 工具本体是一份自包含的静态 HTML（public/edge-split.html），用 iframe 的 **src**
// 加载，而不是 srcDoc 拼字符串：
//   · 它自带全局样式（* { margin:0; padding:0 }）和一堆 id 选择器，
//     塞进 srcDoc 会连样式一起作用到父文档，把设置页的布局打乱；
//   · src 指向独立文档，两边各有一套 CSS 作用域，互不干扰。
//
// 工具只在本机跑（canvas + FileReader），图片不出浏览器，也不碰本库的数据。
// 算式说明（灰度 → 模糊 → Sobel → 膨胀 → 连通区域）收进折叠区：
// 想调参的人会展开看，多数人只想要那块能操作的区域。
import { useMemo } from 'react';

import { SettingsIcon } from './navIcons';
import type { SettingsKey } from './sections';

/** 取 BASE_URL 兜住末尾斜杠——部署到 GitHub Pages 子路径时也要能取到 */
function assetUrl(name: string): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

export function LabEdgeSection() {
  const src = useMemo(() => assetUrl('edge-split.html'), []);

  return (
    <div className="lab-page">
      <LabHead title="边缘分割" subKey="labEdge" />

      <div className="lab-frame">
        <iframe
          className="lab-frame-el"
          src={src}
          title="边缘分割工具"
          // 工具里要点文件、要拖滑块，禁掉缩放和滚动条会让它很难用
          scrolling="auto"
        />
      </div>

      <details className="lab-help">
        <summary>它是怎么切的</summary>
        <p className="muted small">
          灰度化 → 高斯模糊 → Sobel 边缘检测 → 膨胀 → 连通区域分析 → 裁剪。
          调「边缘阈值」和「模糊强度」通常就能分出干净的结果；想要更多小块就把「最小面积」往下调。
          图片只在你自己浏览器里处理，不上传、不入库。
        </p>
      </details>
    </div>
  );
}

/** 子页顶部：图标 + 标题。返回键已上移到吸顶的 PageHead 里，这里不再重复一个 */
export function LabHead({ title, subKey }: { title: string; subKey: SettingsKey }) {
  return (
    <div className="lab-page-head">
      <span className="lab-page-icon" aria-hidden>
        <SettingsIcon k={subKey === 'labAi' ? 'ai' : subKey} />
      </span>
      <h4 className="lab-page-title">{title}</h4>
    </div>
  );
}