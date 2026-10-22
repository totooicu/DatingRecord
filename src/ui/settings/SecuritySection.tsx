// 设置 → 隐私与安全。
//
// 原来「应用锁」「本地库加密」「隐私模式」是三个并列入口，其实它们是同一件事的
// 三个面，用户来回跳才能拼出现在到底有没有被保护：
//
//   应用锁  —— 拦「正在看的这个页面」（防顺手翻看）
//   加密    —— 拦「磁盘上的那份文件」（防直接读 IndexedDB）
//   隐私模式 —— 不拦人，只把标了隐私的条目从列表里藏起来（防旁人一眼看到）
//
// 三块内容原样搬过来，只是排在一页里；各自的状态、按钮、校验都没改，
// 所以原来的应用锁 / 加密回归脚本照旧跑。
import { useState } from 'react';
import { LockSection } from './LockSection';
import { EncSection } from './EncSection';
import { usePrivacyMode, setPrivacyMode } from '../../privacy';

export function SecuritySection() {
  return (
    <>
      <div className="settings-intro">
        <p className="muted small">
          三道防线各管一段，可以只开需要的：<strong>应用锁</strong>挡住拿起手机顺手翻的人；
          <strong>本地库加密</strong>让磁盘上的文件再也读不出内容；<strong>隐私模式</strong>
          则是一个查看开关，把标了「隐私」的条目从列表和详情里藏起来。
        </p>
      </div>

      <LockSection />
      <EncSection />
      <PrivacyCard />
    </>
  );
}

/** 隐私模式开关。以前是悬在目录与子页之上的常驻卡片，合并进本页后不再遮挡目录 */
function PrivacyCard() {
  const privacy = usePrivacyMode();
  const [msg, setMsg] = useState('');

  return (
    <section className="card">
      <div className="card-head">
        <h4 className="card-title">隐私模式</h4>
        <span className={privacy ? 'pill pill-on' : 'pill'}>{privacy ? '已开启' : '未开启'}</span>
      </div>
      <p className="muted small">
        开启后，所有标记为「隐私」的人物 / 事件集 / 事件 / 文件将从列表与详情中隐藏；
        标记本身不会被清除，随时关掉就回来。它只是查看偏好，<strong>不加密、不拦人</strong>——
        真要挡住别人，请配合上面的应用锁。
      </p>
      <div className="row-actions">
        <button
          className={privacy ? 'btn btn-privacy' : 'btn btn-primary'}
          aria-pressed={privacy}
          onClick={() => {
            setPrivacyMode(!privacy);
            setMsg(privacy ? '已关闭隐私模式，标为隐私的条目重新显示' : '已开启隐私模式，标为隐私的条目已隐藏');
          }}
        >
          {privacy ? '关闭隐私模式' : '开启隐私模式'}
        </button>
      </div>
      {msg && <p className="lock-ok">{msg}</p>}
    </section>
  );
}
