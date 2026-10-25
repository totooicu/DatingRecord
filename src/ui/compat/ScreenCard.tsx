// 适配测试：录屏（MediaProjection）。
//
// 壳走的是系统录屏授权弹窗 → 前台服务写 MP4 → 抽帧回一张 JPEG 的路子。抽帧预览是
// 「录了但不知道录到没有」时最有用的一个动作，所以单独留一个按钮。
import { useEffect, useState } from 'react';

import { invoke, onBridgeEvent } from '../../core/compat/bridge';
import { CompatCard, CompatRow, CompatStatus } from './ui';
import { useBridgeStatus } from './useBridgeStatus';

interface ScreenEvent {
  path?: string;
  size?: number;
  error?: string;
}

interface ThumbResult {
  jpegBase64?: string;
  width?: number;
  height?: number;
}

export function ScreenCard() {
  const status = useBridgeStatus('screen', '未测试');
  const [started, setStarted] = useState(false);
  const [capturePath, setCapturePath] = useState('');
  const [thumb, setThumb] = useState<{ src: string; note: string } | null>(null);

  useEffect(() => {
    const offs = [
      onBridgeEvent('screen.recordingStarted', (data) => {
        setStarted(true);
        status.ok(`录屏中：${(data as ScreenEvent)?.path ?? ''}`);
      }),
      onBridgeEvent('screen.recordingStopped', (data) => {
        const d = data as ScreenEvent;
        setStarted(false);
        setCapturePath(d?.path ?? '');
        const mb = d?.size ? (d.size / 1024 / 1024).toFixed(2) : '?';
        status.ok(`录屏完成：${d?.path ?? ''}（${mb}MB）。可点「抽帧预览」`);
      }),
      onBridgeEvent('screen.recordingError', (data) => {
        setStarted(false);
        status.fail(`录屏错误：${(data as ScreenEvent)?.error ?? '未知'}`);
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = async (action: string, params: Record<string, unknown> = {}, okText: string) => {
    status.wait(`${action} …`);
    try {
      await invoke(action, params);
      status.ok(okText);
    } catch (e) {
      status.fail(`${action} 失败：${(e as Error).message}`);
    }
  };

  const grabThumb = async () => {
    if (!capturePath) {
      status.fail('还没有完成的录屏文件');
      return;
    }
    status.wait('screen.thumbnail …');
    try {
      const r = (await invoke('screen.thumbnail', { path: capturePath })) as ThumbResult;
      if (!r.jpegBase64) throw new Error('壳没有返回帧数据');
      setThumb({
        src: `data:image/jpeg;base64,${r.jpegBase64}`,
        note: `预览帧 ${r.width ?? '?'}×${r.height ?? '?'}`,
      });
      status.ok(`预览帧 ${r.width ?? '?'}×${r.height ?? '?'}`);
    } catch (e) {
      status.fail(`抽帧失败：${(e as Error).message}`);
    }
  };

  return (
    <CompatCard title="录屏（MediaProjection）" desc="先授权再录；停止后等「录屏完成」事件，再抽一帧看看。">
      <CompatRow>
        <button
          className="btn btn-primary"
          onClick={() => {
            setStarted(true);
            void call('screen.start', {}, '已请求录屏授权，请在弹出的系统对话框确认…');
          }}
        >
          开始录屏
        </button>
        <button
          className="btn"
          disabled={!started}
          onClick={() => void call('screen.stop', {}, '已发送停止指令，等待保存…')}
        >
          停止
        </button>
        <button
          className="btn"
          onClick={async () => {
            status.wait('screen.status …');
            try {
              const r = await invoke('screen.status');
              status.ok(`录制中：${r.recording ? '是' : '否'}${r.path ? ` · ${String(r.path)}` : ''}`);
            } catch (e) {
              status.fail(`screen.status 失败：${(e as Error).message}`);
            }
          }}
        >
          状态
        </button>
        <button className="btn" onClick={() => void grabThumb()}>
          抽帧预览
        </button>
      </CompatRow>
      <CompatStatus state={status.state} text={status.text} />
      {thumb && (
        <>
          <img className="compat-thumb" src={thumb.src} alt="录屏预览帧" />
          <p className="muted small compat-thumb-note">{thumb.note}</p>
        </>
      )}
    </CompatCard>
  );
}
