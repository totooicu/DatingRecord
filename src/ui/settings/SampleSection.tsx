// 示例数据与重置
import { clearAllData } from '../../core/io';
import { persist } from '../../core/db';
import { loadSampleData } from '../../core/seed';
import { ConfirmButton } from '../common';
import { Section } from './Section';
import { bump } from '../../store';

export function SampleSection() {
  return (
    <Section
      title="示例数据与重置"
      desc="示例数据会创建 2 位人物、5 条事件、3 个事件集，方便快速看到效果。"
    >
      <div className="row-actions">
        <button
          className="btn"
          onClick={() => {
            loadSampleData();
            bump();
          }}
        >
          载入示例数据
        </button>
        <ConfirmButton
          text="清空全部数据"
          danger
          confirmText="确认清空？建议先导出备份！"
          onConfirm={async () => {
            await clearAllData();
            await persist(); // 必须先落盘再刷新，否则 debounce 未触发会「清不掉」
            location.reload();
          }}
        />
      </div>
    </Section>
  );
}
