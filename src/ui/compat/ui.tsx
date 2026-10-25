// 「软件适配测试」共用的几块外壳：卡片、按钮行、状态条、顶部汇总。
//
// 原作 geckoview_example/assets/test.html 是一张卡片测一件事、下面一行状态文字；
// 这里保留同样的节奏，只把配色和字号接进本项目的设计变量，别让这一页看起来像
// 从外面贴进来的。
import type { ReactNode } from 'react';

import { useTestResults, type TestState } from './report';

/** 一张测试卡。right 放「刷新」这类单按钮 */
export function CompatCard({
  title,
  desc,
  right,
  children,
}: {
  title: string;
  desc?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card compat-card">
      <div className="card-head">
        <h4 className="card-title">{title}</h4>
        {right && <div className="compat-head-right">{right}</div>}
      </div>
      {desc && <p className="compat-desc muted small">{desc}</p>}
      {children}
    </section>
  );
}

/** 按钮 / 输入一行；窄屏自动换行，输入框可伸缩 */
export function CompatRow({ children }: { children: ReactNode }) {
  return <div className="compat-row">{children}</div>;
}

export type StatusState = TestState | 'wait';

/** 一行结果。ok / err 带底色，一眼分得清；wait 只是「请求中」 */
export function CompatStatus({ state, text }: { state: StatusState; text: string }) {
  return (
    <div className={`compat-status compat-${state}`} role="status">
      {text}
    </div>
  );
}

/** 顶部汇总：几条测过、几条过、几条没过 */
export function CompatSummary() {
  const list = useTestResults();
  const ok = list.filter((t) => t.state === 'ok').length;
  const err = list.filter((t) => t.state === 'err').length;
  const idle = list.length - ok - err;
  return (
    <div className="compat-summary">
      <div className="compat-summary-line">
        <strong>
          {ok} / {list.length} 通过
        </strong>
        <span className="muted small">
          {err ? `${err} 项失败` : '暂无失败'}
          {idle ? ` · ${idle} 项未测` : ''}
        </span>
      </div>
      <div className="compat-chips">
        {list.map((t) => (
          <span key={t.id} className={`compat-chip compat-${t.state}`}>
            {t.label}
            <em>{t.state === 'ok' ? '✓' : t.state === 'err' ? '✗' : '·'}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
