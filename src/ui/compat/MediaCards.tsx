// 适配测试：麦克风（getUserMedia）与定位（geolocation）两张卡。
//
// 这两项不靠原生桥，走的是浏览器标准 API——正好用来判断「问题出在壳上还是出在
// 系统权限上」：桥不通但这两项通，说明 WebView 本身没问题；两项也不通，先查权限。
import { useEffect, useRef, useState } from 'react';

import { CompatCard, CompatRow, CompatStatus, type StatusState } from './ui';
import { setTestResult } from './report';
import {
  micDeniedHint,
  micErrorHint,
  permissionLabel,
  probeMic,
  trackSummary,
  type MicProbeResult,
} from './mic';

/* ---------------- 麦克风 ---------------- */

export function MicCard() {
  const [state, setState] = useState<StatusState>('idle');
  const [text, setText] = useState('未测试');
  const [meterOn, setMeterOn] = useState(false);
  const [meterHint, setMeterHint] = useState('');
  const [denied, setDenied] = useState(false);
  const [diag, setDiag] = useState<MicProbeResult | null>(null);
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
    setMeterHint('');
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
    // 先把上一次握着的流放下：同一页面重复申请时，某些机型会直接报 NotReadableError
    stop();
    setState('wait');
    setText('请求中… 会按「默认 → 原始音频 → 指定设备」依次试，可能要过几轮系统弹窗');
    setDiag(null);
    setDenied(false);

    const r = await probeMic();
    setDiag(r);

    // 权限被系统拒绝：不试约束，直接给恢复路径。安卓壳拒绝一次同源就记住了，
    // 不说清楚「去哪里恢复」，用户只会反复重点「请求麦克风」然后反复失败。
    if (r.denied) {
      setState('err');
      setText('录音权限已被系统拒绝，不会再弹授权框');
      setTestResult('mic', 'err', '权限被拒');
      setDenied(true);
      return;
    }

    if (!r.stream) {
      const last = r.failures[r.failures.length - 1];
      setState('err');
      setText(`被拒绝或失败：${last?.name ?? 'Error'} · ${last?.message ?? ''}`);
      setTestResult('mic', 'err', last?.name ?? '失败');
      return;
    }

    streamRef.current = r.stream;
    const tracks = r.stream.getAudioTracks();
    const param = trackSummary(r.track) || '参数未知';
    const retried = r.failures.length ? `；前 ${r.failures.length} 档失败（${r.failures.map((f) => f.name).join(' / ')}）` : '';
    setState('ok');
    setText(`已授权（${r.okLabel}）。轨道数：${tracks.length}，${param}${retried}`);
    setTestResult('mic', 'ok', r.okLabel);

    setMeterOn(true);
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('不支持 AudioContext');
      const ctx = new Ctor();
      ctxRef.current = ctx;
      // 安卓壳的系统 WebView 默认「媒体播放需要用户手势」：探测链上有 await，
      // 手势上下文已经断了，AudioContext 会停在 suspended——频谱全是 0，
      // 页面显示「已授权」但音量条一动不动，看着就像录音没拿到。
      // 先主动 resume；注意真机上没有手势时 resume() 的 promise 会一直挂着，
      // 不能死等——赛跑 400ms，还不醒就挂一个一次性 pointerdown，
      // 用户点一下页面任意处再拉起来。
      if (ctx.state !== 'running') {
        await Promise.race([
          ctx.resume().catch(() => undefined),
          new Promise((r) => setTimeout(r, 400)),
        ]);
      }
      if (ctx.state !== 'running') {
        setMeterHint('音量条还没激活：这台壳要求先有一次点按。点页面任意位置即可启动音量监测。');
        const wake = () => {
          void ctxRef.current?.resume().catch(() => undefined);
          if (ctxRef.current?.state === 'running') {
            setMeterHint('');
            document.removeEventListener('pointerdown', wake);
          }
        };
        document.addEventListener('pointerdown', wake);
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(r.stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        // stop() 之后 ctx 已 close，getByteFrequencyData 会抛；直接收工
        if (!ctxRef.current || ctxRef.current.state === 'closed') return;
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
  };

  const doStop = () => {
    stop();
    setState('idle');
    setText('已停止');
  };

  const lastFailure = diag?.failures[diag.failures.length - 1];

  return (
    <CompatCard
      title="麦克风测试（getUserMedia）"
      desc="标准 Web API；授权后看音量条有没有起伏。失败时会把每一档约束的结果和下一步怎么做都列出来。"
    >
      <CompatRow>
        <button className="btn btn-primary" onClick={start} disabled={state === 'wait'}>
          请求麦克风
        </button>
        <button className="btn" onClick={doStop} disabled={state !== 'ok'}>
          停止
        </button>
      </CompatRow>
      <CompatStatus state={state} text={text} />
      {meterOn && meterHint && <p className="muted small compat-hint">{meterHint}</p>}
      {meterOn && (
        <div className="compat-meter" aria-hidden>
          <i
            ref={(el) => {
              meterRef.current = el;
            }}
          />
        </div>
      )}

      {denied && (
        <p className="compat-fix muted small">
          <strong>怎么恢复：</strong>
          {micDeniedHint()}
        </p>
      )}

      {diag && (
        <div className="compat-diag">
          <p className="muted small">
            音频输入：
            {diag.inputs.length
              ? `${diag.inputs.length} 个${
                  diag.inputs.some((d) => d.label)
                    ? `（${diag.inputs.map((d) => d.label || '未命名').join('、')}）`
                    : '（未授权时系统不给设备名）'
                }`
              : '0 个'}
            {' · '}权限：{permissionLabel(diag.permission)}
          </p>
          {diag.failures.length > 0 && (
            <ul className="compat-attempts">
              {diag.failures.map((f) => (
                <li key={f.label}>
                  <span className="compat-attempt-label">{f.label}</span>
                  <span className="compat-attempt-err">
                    {f.name} · {f.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lastFailure && (
            <p className="compat-fix muted small">
              <strong>怎么办：</strong>
              {micErrorHint(lastFailure.name)}
            </p>
          )}
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
