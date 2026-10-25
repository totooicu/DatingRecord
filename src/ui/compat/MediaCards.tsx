// 适配测试：麦克风（getUserMedia）与定位（geolocation）两张卡。
//
// 这两项不靠原生桥，走的是浏览器标准 API——正好用来判断「问题出在壳上还是出在
// 系统权限上」：桥不通但这两项通，说明 WebView 本身没问题；两项也不通，先查权限。
import { useEffect, useRef, useState } from 'react';

import { CompatCard, CompatRow, CompatStatus, type StatusState } from './ui';
import { setTestResult } from './report';

/* ---------------- 麦克风 ---------------- */

export function MicCard() {
  const [state, setState] = useState<StatusState>('idle');
  const [text, setText] = useState('未测试');
  const [meterOn, setMeterOn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLElement | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (meterRef.current) meterRef.current.style.width = '0%';
    setMeterOn(false);
  };

  // 离开这一页就把麦克风关掉：适配测试不该在后台一直占着录音
  useEffect(() => stop, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('err');
      setText('当前环境没有 getUserMedia（非安全上下文或壳未开启）');
      setTestResult('mic', 'err', '无 getUserMedia');
      return;
    }
    setState('wait');
    setText('请求中… 请在弹出的系统对话框里允许');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const tracks = stream.getAudioTracks();
      const rate = tracks[0]?.getSettings().sampleRate;
      setState('ok');
      setText(`已授权。轨道数：${tracks.length}，采样率：${rate || '未知'}`);
      setTestResult('mic', 'ok', rate ? `${Math.round(rate / 1000)} kHz` : '已授权');
      setMeterOn(true);
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error('不支持 AudioContext');
        const ctx = new Ctor();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const level = (sum / data.length / 255) * 100;
          if (meterRef.current) meterRef.current.style.width = `${level.toFixed(1)}%`;
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setText((t) => `${t}（音量监测不可用：${(e as Error).message}）`);
      }
    } catch (err) {
      const e = err as DOMException | undefined;
      setState('err');
      setText(`被拒绝或失败：${e?.name ?? String(err)} · ${e?.message ?? ''}`);
      setTestResult('mic', 'err', e?.name ?? '失败');
    }
  };

  const doStop = () => {
    stop();
    setState('idle');
    setText('已停止');
  };

  return (
    <CompatCard title="麦克风测试（getUserMedia）" desc="标准 Web API；授权后看音量条有没有起伏。">
      <CompatRow>
        <button className="btn btn-primary" onClick={start} disabled={state === 'wait'}>
          请求麦克风
        </button>
        <button className="btn" onClick={doStop} disabled={state !== 'ok'}>
          停止
        </button>
      </CompatRow>
      <CompatStatus state={state} text={text} />
      {meterOn && (
        <div className="compat-meter" aria-hidden>
          <i ref={(el) => { meterRef.current = el; }} />
        </div>
      )}
    </CompatCard>
  );
}

/* ---------------- 定位 ---------------- */

export function GeoCard() {
  const [state, setState] = useState<StatusState>('idle');
  const [text, setText] = useState('未测试');

  const run = () => {
    if (!('geolocation' in navigator)) {
      setState('err');
      setText('当前环境没有 geolocation');
      setTestResult('geo', 'err', '无 geolocation');
      return;
    }
    setState('wait');
    setText('请求中… 请允许定位权限');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setState('ok');
        setText(
          `纬度 ${latitude.toFixed(4)}，经度 ${longitude.toFixed(4)}，精度 ${
            accuracy ? `${Math.round(accuracy)}m` : '未知'
          }`,
        );
        setTestResult('geo', 'ok', accuracy ? `±${Math.round(accuracy)}m` : '已定位');
      },
      (err) => {
        setState('err');
        setText(`失败：${err.code} ${err.message}`);
        setTestResult('geo', 'err', `错误码 ${err.code}`);
      },
      // 和壳里那一页保持一致：不开高精度，超时 10s，不吃缓存
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  };

  return (
    <CompatCard title="定位测试（geolocation）" desc="用的是系统定位服务；被拒绝时错误码比文字更有用。">
      <CompatRow>
        <button className="btn btn-primary" onClick={run} disabled={state === 'wait'}>
          请求定位
        </button>
      </CompatRow>
      <CompatStatus state={state} text={text} />
    </CompatCard>
  );
}
