// 「功能体验」：把一些独立的图像小工具挂在设置里，随手试。
//
// 工具本体是一份自包含的静态 HTML（public/edge-split.html），用 iframe 的
// **src** 加载，而不是 srcDoc 拼字符串：
//   · 它自带全局样式（* { margin:0; padding:0 }）和一堆 id 选择器，
//     塞进 srcDoc 会连样式一起作用到父文档，把设置页的布局打乱；
//   · src 指向独立文档，两边各有一套 CSS 作用域，互不干扰。
//
// 工具只在本机跑（canvas + FileReader），图片不出浏览器，也不碰本库的数据。
import { useMemo } from 'react';

import { Section } from './Section';

/** 取 BASE_URL 兜住末尾斜杠——部署到 GitHub Pages 子路径时也要能取到 */
function assetUrl(name: string): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

export function LabSection() {
  const src = useMemo(() => assetUrl('edge-split.html'), []);

  return (
    <Section
      title="功能体验"
      desc="一些独立的小工具，纯粹图一乐。图片只在你自己浏览器里处理，不上传、不入库。"
    >
      <div className="lab-frame">
        <iframe
          className="lab-frame-el"
          src={src}
          title="边缘分割工具"
          // 工具里要点文件、要拖滑块，禁掉缩放和滚动条会让它很难用
          scrolling="auto"
        />
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        边缘分割：灰度化 → 高斯模糊 → Sobel 边缘检测 → 膨胀 → 连通区域分析 → 裁剪。
        调「边缘阈值」和「模糊强度」通常就能分出干净的结果；想要更多小块就把「最小面积」往下调。
      </p>
    </Section>
  );
}
