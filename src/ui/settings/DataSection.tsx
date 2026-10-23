// 设置 → 数据与统计。
//
// 「库概览」和「示例数据与重置」原来各占一个入口，但两者都只跟「这一个库整体」
// 有关：一个看里面有多少东西，一个把它填满或清空。合到一页，看完数字顺手就能
// 决定要不要重来。
import { OverviewSection } from './OverviewSection';
import { SampleSection } from './SampleSection';

export function DataSection() {
  return (
    <>
      <div className="settings-intro">
        <p className="muted small">
          上半部分是整个库的家底（数量、体积、操作日志），下半部分是用来试手和推倒重来的开关。
          <strong>清空全部数据不可撤销</strong>，动手前请先到「备份与分享 → 数据备份」导出 JSON。
        </p>
      </div>
      <OverviewSection />
      <SampleSection />
    </>
  );
}
