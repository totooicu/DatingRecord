// 麦克风探测：把 getUserMedia 的失败拆成「能照着修的原因」。
//
// 壳里最常见的是 NotReadableError · Could not start audio source——这一条在 Android 上
// 意味着 AudioRecord 根本没起来：可能是系统/壳没给录音权限、麦克风被别的应用占着、
// 系统麦克风开关关掉，也可能只是默认约束跟这台设备对不上。所以这里按「由宽到严」
// 依次试三档，并把每一次的失败原因都留着给页面展示：
//
//   1. { audio: true }                     —— 默认，先按设备的默认参数来
//   2. 原始音频（关掉回声消除 / 降噪 / 自动增益）—— 某些设备的处理链初始化失败，要绕开
//   3. 指定具体输入设备（deviceId exact）  —— 默认设备有问题时，点名另一路输入
//
// 权限被拒（NotAllowedError / SecurityError）时不继续试：换约束救不回来，只会让人
// 多点几次系统弹窗。
//
// 只做探测，不持有流——调用方拿到 stream 后自己在卸载时停掉。

export interface MicAttempt {
  label: string;
  constraints: MediaStreamConstraints;
}

export interface MicFailure {
  label: string;
  name: string;
  message: string;
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

export interface MicProbeResult {
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  /** 成功的那一档，失败时为空串 */
  okLabel: string;
  failures: MicFailure[];
  /** 枚举到的音频输入设备（未授权时 label 通常为空） */
  inputs: MicDevice[];
  /** Permissions API 里的麦克风状态：granted / denied / prompt / unknown / unsupported */
  permission: string;
}

/** 按设备列表拼出「由宽到严」的三档约束 */
export function micAttempts(inputs: MicDevice[]): MicAttempt[] {
  const list: MicAttempt[] = [
    { label: '默认音频输入', constraints: { audio: true } },
    {
      label: '原始音频（关回声消除 / 降噪 / 自动增益）',
      constraints: { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    },
  ];
  // deviceId 在未授权时可能是空串，拿它去 exact 只会换一个 OverconstrainedError
  const named = inputs.filter((d) => d.deviceId && d.deviceId !== 'default').slice(0, 2);
  named.forEach((d, i) => {
    list.push({
      label: `指定输入设备 #${i + 1}${d.label ? `（${d.label}）` : ''}`,
      constraints: { audio: { deviceId: { exact: d.deviceId } } },
    });
  });
  return list;
}

async function listInputs(): Promise<MicDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

async function queryPermission(): Promise<string> {
  try {
    const st = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
    return st?.state ?? 'unknown';
  } catch {
    // 部分 WebView / GeckoView 没有 microphone 这一项，查询会抛
    return 'unsupported';
  }
}

export async function probeMic(): Promise<MicProbeResult> {
  const inputs = await listInputs();
  const permission = await queryPermission();
  const failures: MicFailure[] = [];

  for (const attempt of micAttempts(inputs)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      return {
        stream,
        track: stream.getAudioTracks()[0] ?? null,
        okLabel: attempt.label,
        failures,
        inputs,
        permission,
      };
    } catch (e) {
      const err = e as DOMException | undefined;
      const name = err?.name ?? 'Error';
      failures.push({ label: attempt.label, name, message: err?.message ?? String(e) });
      // 权限类错误换约束也没用，直接收手
      if (name === 'NotAllowedError' || name === 'SecurityError') break;
      // 留一点时间让上一档的请求把手松开：安卓上连着重开常常还是「设备忙」
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return { stream: null, track: null, okLabel: '', failures, inputs, permission };
}

/** 每条失败原因对应的「下一步做什么」，页面上只显示最后一条 */
export function micErrorHint(name: string): string {
  switch (name) {
    case 'NotAllowedError':
      return '权限被拒：壳没弹授权框，或点了拒绝。安卓壳要在 AndroidManifest 声明 RECORD_AUDIO、运行时申请，并在系统 WebView 的 WebChromeClient.onPermissionRequest 里放行（若仍是 GeckoView 壳，对应的是 PermissionDelegate.onMediaPermissionRequest）。';
    case 'NotFoundError':
      return '这台设备上没有可用的音频输入（模拟器、或被系统禁用的麦克风都会这样）。换真机再试。';
    case 'NotReadableError':
      return '「Could not start audio source」是系统层没把麦克风交出来，按这个顺序查：① 关掉其它正在录音的应用（语音助手、会议、录音机）再点一次；② 系统麦克风 / 隐私开关是不是被关了；③ 壳若已用录音或录屏验证过权限（RECORD_AUDIO + WebChromeClient.onPermissionRequest 放行），就不用再怀疑壳，问题在设备侧；④ 模拟器、没有麦克风的设备上必然如此。';
    case 'OverconstrainedError':
      return '约束太严：指定的输入设备已被拔掉 / 换了。直接再点一次「请求麦克风」，会从默认设备重试。';
    case 'SecurityError':
      return '当前页面不是安全上下文（非 https / file），浏览器禁止访问麦克风。';
    case 'AbortError':
      return '系统打断了这次请求（来电、切后台等），重试即可。';
    default:
      return '未知错误，把上面这行原文一起提给壳那边排查。';
  }
}

/** Permissions API 的状态写成中文 */
export function permissionLabel(state: string): string {
  switch (state) {
    case 'granted':
      return '已授权';
    case 'denied':
      return '已拒绝';
    case 'prompt':
      return '未决定';
    case 'unsupported':
      return '该环境不支持查询';
    default:
      return '未知';
  }
}

/** 轨道参数压成一行，方便对照「有没有真的拿到音频」 */
export function trackSummary(track: MediaStreamTrack | null): string {
  if (!track) return '';
  const s = track.getSettings();
  const bits = [
    s.sampleRate ? `${Math.round(s.sampleRate / 1000)} kHz` : '',
    s.channelCount ? `${s.channelCount} 声道` : '',
    s.deviceId ? `设备 ${s.deviceId.slice(0, 6)}` : '',
    // label 不在 MediaTrackSettings 的类型里，部分浏览器会给（拿它看具体是哪路输入）
    (s as MediaTrackSettings & { label?: string }).label || '',
  ].filter(Boolean);
  return bits.join(' · ');
}
