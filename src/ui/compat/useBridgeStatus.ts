// 桥类测试卡共用的一行状态 + 汇总上报。
//
// 蓝牙、文件、录屏都是「点一个按钮 → 等壳回话」，状态写法完全一样：请求中 / 成功 /
// 失败三态，失败原因同时写进汇总表。抽出来免得三份卡片各写一套措辞。
import { useState } from 'react';

import { setTestResult, type TestId } from './report';
import type { StatusState } from './ui';

export interface BridgeStatus {
  state: StatusState;
  text: string;
  wait: (msg: string) => void;
  ok: (msg: string, note?: string) => void;
  fail: (msg: string) => void;
}

export function useBridgeStatus(test: TestId, idleText: string): BridgeStatus {
  const [state, setState] = useState<StatusState>('idle');
  const [text, setText] = useState(idleText);

  return {
    state,
    text,
    wait: (msg) => {
      setState('wait');
      setText(msg);
    },
    ok: (msg, note) => {
      setState('ok');
      setText(msg);
      setTestResult(test, 'ok', note);
    },
    fail: (msg) => {
      setState('err');
      setText(msg);
      setTestResult(test, 'err', msg.slice(0, 40));
    },
  };
}
