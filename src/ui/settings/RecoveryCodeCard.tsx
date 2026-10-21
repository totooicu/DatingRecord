// 启用加密后那张「恢复码」卡片。
//
// 恢复码只在这里出现一次，之后应用里再也看不到——所以必须逼用户当场
// 抄下来：不光显示，还要他照着打一遍。少这一步，迟早有人「以为记下了」
// 结果把口令也忘了，数据永久打不开。
//
// 拆成单独文件：EncSection 已经够长了，而这张卡片的生命周期很独立
// （只在那一次流程里存在）。

import { useState } from 'react';
import { normalizeRecoveryCode } from '../../core/crypto';

export function RecoveryCodeCard({
  code,
  onConfirm,
  onCancel,
}: {
  code: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const ok = normalizeRecoveryCode(typed) === normalizeRecoveryCode(code);

  return (
    <div className="enc-recovery">
      <p className="enc-recovery-title">抄下这串恢复码</p>
      <p className="muted small">
        口令忘了就靠它开门。它只显示这一次，也不会存在这台设备上——抄到纸上或密码管理器里。
      </p>
      <p className="enc-code">{code}</p>
      <label>
        照着打一遍，确认你抄对了
        <input
          value={typed}
          autoComplete="off"
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
          onChange={(e) => {
            setTyped(e.target.value);
            setErr('');
          }}
        />
      </label>
      {err && <p className="lock-err">{err}</p>}
      <div className="lock-acts">
        <button
          className="btn btn-primary"
          onClick={() => {
            if (!ok) return setErr('和上面的恢复码不一致，再检查一遍');
            onConfirm();
          }}
        >
          确认抄好，开启加密
        </button>
        <button className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
