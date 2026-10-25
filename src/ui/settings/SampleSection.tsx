// 示例数据与重置
import { useState } from 'react';
import { clearAllData } from '../../core/io';
import { persist } from '../../core/db';
import { loadSampleData } from '../../core/seed';
import { ConfirmButton } from '../common';
import { Section } from './Section';
import { bump } from '../../store';

export function SampleSection() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  return (
    <Section
      title="示例数据与重置"
      desc="示例数据会铺开 25 条事件：咖啡店、影院、美术馆、书店、公园、火锅店、Livehouse、游乐园、医院、海边、山里、机场、菜市场……外加一套回忆录和一份定位记录，方便快速看到各种场景下的效果。"
    >
      <div className="row-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg('');
            try {
              const r = await loadSampleData();
              bump();
              setMsg(
                `已创建 ${r.persons} 位人物、${r.events} 条事件、${r.collections} 个事件集、` +
                  `${r.memoirs} 套回忆录、${r.files} 个附件。`,
              );
            } catch (e) {
              setMsg(`载入失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在载入…' : '载入示例数据'}
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
      {msg && <p className="muted">{msg}</p>}
    </Section>
  );
}
