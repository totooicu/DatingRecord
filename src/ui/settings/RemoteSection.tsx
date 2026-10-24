// 跨设备操作：服务端 / 客户端两块面板。
//
// 两条连接方式：
//   中继 —— 局域网里跑 tools/remote-relay，页面由中继托管，ws 明文转发
//   直连 —— WebRTC DataChannel，两个浏览器直接传，靠复制配对码完成信令
//
// 不管哪条，切数据都由 core/remote/router 统一负责，这个页面只管配对和展示。

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  addressForHostPort,
  adoptDirectClient,
  adoptDirectHost,
  configOf,
  connectClient,
  createDirectClient,
  createDirectHost,
  ensureRelayListener,
  getRemoteState,
  leaveRemoteAndReload,
  localDeviceName,
  probeRemote,
  relayInfo,
  startHost,
  stopHost,
  subscribeRemote,
  type DirectClientSession,
  type DirectHostSession,
  type LinkKind,
} from '../../core/remote';
import { Field } from '../common';

function useRemote() {
  return useSyncExternalStore(subscribeRemote, getRemoteState, getRemoteState);
}

function randomToken(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

export function RemoteSection() {
  const remote = useRemote();
  /** 空闲时选连接方式；已连上则沿用当前那条 */
  const [link, setLink] = useState<LinkKind>('relay');
  const [port, setPort] = useState('4173');
  const [token, setToken] = useState(() => randomToken());
  const [addr, setAddr] = useState('');
  const [addrToken, setAddrToken] = useState('');
  const [busy, setBusy] = useState<'' | 'host' | 'client'>('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [relay, setRelay] = useState<Awaited<ReturnType<typeof relayInfo>>>(null);

  // 直连配对
  const [stun, setStun] = useState('');
  const [inviteIn, setInviteIn] = useState('');
  const [answerIn, setAnswerIn] = useState('');
  const [hostSession, setHostSession] = useState<{ s: DirectHostSession; invite: string } | null>(null);
  const [clientSession, setClientSession] = useState<{ s: DirectClientSession; answer: string } | null>(null);

  useEffect(() => {
    void relayInfo().then(setRelay);
  }, []);

  const hostCfg = remote.mode === 'host' ? remote.label : '';
  const isDirect = remote.transport === 'direct';
  const choose = remote.mode === 'local';

  // 给客户端的连接串：地址用当前页面的主机名，换设备时把这段抄过去。
  // 页面在本机用 localhost / 127.0.0.1 打开时，抄到手机上连的是手机自己，
  // 所以换成中继报上来的局域网地址。
  const loopback =
    typeof location !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  const lanAddr = relay?.addresses?.find((a) => !a.startsWith('127.') && a !== '::1');
  const shareHost =
    typeof location !== 'undefined' ? (loopback && lanAddr ? lanAddr : location.hostname) : '127.0.0.1';
  const shareText = useMemo(() => {
    if (!hostCfg) return '';
    return `${shareHost}:${port}?token=${token}`;
  }, [hostCfg, shareHost, port, token]);

  const copy = async (text: string, what: string) => {
    setErr('');
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`已复制${what}`);
    } catch {
      setErr('复制失败：请长按文本框手动全选复制');
    }
  };

  const start = async () => {
    setErr('');
    setMsg('');
    setBusy('host');
    try {
      const parsed = addressForHostPort(port, token);
      // 同源中继可以把用户填的端口也开起来；静态托管只能连已经开着的端口
      let sameOriginRelay = false;
      try {
        sameOriginRelay = await ensureRelayListener(parsed.port, token);
      } catch (e) {
        throw new Error(`中继拒绝在 ${parsed.port} 端口监听：${e instanceof Error ? e.message : String(e)}`);
      }
      await startHost(configOf(parsed));
      // 中继可能刚被 POST 开起来，这里补一次自述，连接串才能拿到局域网地址
      void relayInfo().then(setRelay);
      setMsg(
        sameOriginRelay
          ? '服务已开启。另一台设备打开同一个网址，在「作为客户端」里填上面的连接串。'
          : '已连上中继。若另一台设备连不上，请确认中继进程在运行，并让客户端通过中继提供的页面访问。',
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const connect = async () => {
    setErr('');
    setMsg('');
    if (remote.mode === 'host') {
      // 同一页既当服务端又当客户端，连接后刷新会把服务端一起带走
      setErr('本页正在作为服务端，不能同时当客户端。请换一台设备或新开一个标签页来连。');
      return;
    }
    setBusy('client');
    try {
      const label = await probeRemote(addr, addrToken);
      setMsg(`已连上 ${label}，正在切换数据…`);
      await connectClient(addr, addrToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  // ---------------- 直连：服务端 ----------------

  const makeInvite = async () => {
    setErr('');
    setMsg('');
    setBusy('host');
    try {
      const s = createDirectHost({ stun, name: localDeviceName() });
      const invite = await s.invite;
      setHostSession({ s, invite });
      setMsg('邀请码已生成：用聊天工具发给另一台设备。');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const acceptAnswer = async () => {
    if (!hostSession) return;
    setErr('');
    setMsg('');
    setBusy('host');
    try {
      await hostSession.s.complete(answerIn);
      setMsg('应答码已接受，正在建立直连…');
      await adoptDirectHost(hostSession.s);
      setHostSession(null);
      setAnswerIn('');
      setMsg('直连已建立，客户端正在读取数据。');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const cancelHost = () => {
    hostSession?.s.close();
    setHostSession(null);
    setAnswerIn('');
    setMsg('已取消配对');
  };

  // ---------------- 直连：客户端 ----------------

  const makeAnswer = async () => {
    setErr('');
    setMsg('');
    setBusy('client');
    try {
      const s = createDirectClient(inviteIn, localDeviceName());
      const answer = await s.answer;
      setClientSession({ s, answer });
      setMsg('应答码已生成：把它发回服务端页面。');
      void adoptDirectClient(s)
        .then(() => {
          setClientSession(null);
          setBusy('');
        })
        .catch((e) => {
          setErr(e instanceof Error ? e.message : String(e));
          setClientSession(null);
          setBusy('');
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  const cancelClient = () => {
    clientSession?.s.close();
    setClientSession(null);
    setBusy('');
  };

  return (
    <div className="remote-section">
      <p className="muted small">
        连接后，客户端的每一次读写都发生在服务端的库上，不会写进客户端浏览器；断开或刷新失败时立即回到本机数据。
        服务端自身的数据照常保存在本机。
      </p>

      {choose && !hostSession && !clientSession && (
        <div className="remote-switch" role="tablist" aria-label="连接方式">
          <button
            role="tab"
            aria-selected={link === 'relay'}
            className={link === 'relay' ? 'on' : ''}
            onClick={() => setLink('relay')}
          >
            中继（局域网）
          </button>
          <button
            role="tab"
            aria-selected={link === 'direct'}
            className={link === 'direct' ? 'on' : ''}
            onClick={() => setLink('direct')}
          >
            直连（WebRTC）
          </button>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">作为服务端</h4>
          {remote.mode === 'host' && (
            <span className="remote-badge remote-badge-on">{isDirect ? '直连中' : '已开启'}</span>
          )}
        </div>

        {remote.mode === 'host' ? (
          <>
            <p className="remote-line">
              <span className="muted small">{isDirect ? '方式' : '监听'}</span> <code>{remote.label}</code>
            </p>
            {!isDirect && (
              <>
                <p className="remote-line">
                  <span className="muted small">客户端连接串</span>
                </p>
                <textarea className="remote-share" readOnly value={shareText} rows={2} />
                {loopback && lanAddr && (
                  <p className="muted small">
                    已把地址换成本机局域网 IP；<code>127.0.0.1</code> 只在本机有效，手机连不上。
                  </p>
                )}
              </>
            )}
            <p className="muted small">
              当前 {remote.clients.length} 个客户端
              {remote.clients.length > 0 ? `：${remote.clients.map((c) => c.name).join('、')}` : ''}
            </p>
            <div className="remote-actions">
              <button className="btn btn-danger btn-sm" onClick={() => stopHost()}>
                停止服务
              </button>
            </div>
          </>
        ) : link === 'relay' ? (
          <>
            <label className="field">
              <span className="field-label">端口号</span>
              <input
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="4173"
              />
            </label>
            <label className="field">
              <span className="field-label">
                访问 token
                <em>客户端必须填同一个，否则中继直接拒绝</em>
              </span>
              <div className="remote-token-row">
                <input value={token} onChange={(e) => setToken(e.target.value)} />
                <button className="btn btn-sm" onClick={() => setToken(randomToken())}>
                  换一个
                </button>
              </div>
            </label>
            <div className="remote-actions">
              <button className="btn btn-primary" onClick={() => void start()} disabled={busy !== ''}>
                {busy === 'host' ? '正在开启…' : '开启跨设备操作'}
              </button>
            </div>
            {!relay && (
              <div className="remote-hint">
                <p className="muted small">
                  浏览器页面不能自己监听端口，需要先在本机运行项目自带的中继；然后由中继托管这个页面。
                  在其他设备上打开 <code>http://本机IP:{port}</code> 即可。
                </p>
                <code className="remote-cmd">node tools/remote-relay/server.mjs --port {port} --token {token}</code>
              </div>
            )}
          </>
        ) : hostSession ? (
          <>
            <p className="muted small">邀请码（发给另一台设备，在它的「作为客户端」里粘贴）</p>
            <textarea
              className="remote-share"
              readOnly
              rows={4}
              value={hostSession.invite}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="remote-actions">
              <button className="btn btn-sm" onClick={() => void copy(hostSession.invite, '邀请码')}>
                复制邀请码
              </button>
            </div>
            <label className="field">
              <span className="field-label">
                对方的应答码
                <em>对方生成后发回来，粘贴到这里</em>
              </span>
              <textarea
                className="remote-share remote-share-in"
                rows={4}
                value={answerIn}
                onChange={(e) => setAnswerIn(e.target.value)}
                placeholder="DR1A:…"
              />
            </label>
            <div className="remote-actions">
              <button
                className="btn btn-primary"
                onClick={() => void acceptAnswer()}
                disabled={busy !== '' || !answerIn.trim()}
              >
                {busy === 'host' ? '正在配对…' : '完成配对'}
              </button>
              <button className="btn btn-sm" onClick={cancelHost}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              直连不需要中继和端口：两个浏览器交换一次配对码后直接传数据，适合同一局域网，也适合都能访问的
              http(s) 页面。
            </p>
            <label className="field">
              <span className="field-label">
                STUN（可选）
                <em>留空 = 只走局域网；跨公网可填 stun:host:port</em>
              </span>
              <input
                value={stun}
                onChange={(e) => setStun(e.target.value)}
                placeholder="stun:stun.l.google.com:19302"
                autoComplete="off"
              />
            </label>
            <div className="remote-actions">
              <button className="btn btn-primary" onClick={() => void makeInvite()} disabled={busy !== ''}>
                {busy === 'host' ? '正在生成…' : '生成邀请码'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">作为客户端</h4>
          {remote.mode === 'client' && (
            <span className="remote-badge remote-badge-on">{isDirect ? '直连数据' : '使用服务端数据'}</span>
          )}
        </div>

        {remote.mode === 'client' ? (
          <>
            <p className="remote-line">
              <span className="muted small">已连接</span> <code>{remote.label}</code>
            </p>
            <p className="muted small">当前显示的是服务端数据。断开后立刻恢复读取本机数据，服务端的改动不会留在本机。</p>
            <div className="remote-actions">
              <button className="btn btn-danger btn-sm" onClick={() => leaveRemoteAndReload('已断开，回到本地数据')}>
                断开并回到本地
              </button>
            </div>
          </>
        ) : link === 'relay' ? (
          <>
            <label className="field">
              <span className="field-label">
                地址:端口?token=
                <em>示例：192.168.1.8:4173?token=abc123</em>
              </span>
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="192.168.1.8:4173?token=abc123"
                autoComplete="off"
              />
            </label>
            <Field label="token（连接串里没写时用这个）">
              <input
                value={addrToken}
                onChange={(e) => setAddrToken(e.target.value)}
                placeholder="与服务端一致"
                autoComplete="off"
              />
            </Field>
            <div className="remote-actions">
              <button
                className="btn btn-primary"
                onClick={() => void connect()}
                disabled={busy !== '' || remote.mode === 'host'}
              >
                {busy === 'client' ? '正在连接…' : '连接服务端'}
              </button>
            </div>
            <p className="muted small">
              {remote.mode === 'host'
                ? '本页正在作为服务端，要连接请换一台设备或新开一个标签页。'
                : '客户端页面必须由服务端中继托管（同一局域网的 http 地址），否则 https 页面连不上 ws://。'}
            </p>
          </>
        ) : clientSession ? (
          <>
            <p className="muted small">应答码（发回服务端页面）</p>
            <textarea
              className="remote-share"
              readOnly
              rows={4}
              value={clientSession.answer}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="remote-actions">
              <button className="btn btn-sm" onClick={() => void copy(clientSession.answer, '应答码')}>
                复制应答码
              </button>
              <button className="btn btn-sm" onClick={cancelClient}>
                取消
              </button>
            </div>
            <p className="muted small">等待服务端粘贴应答码…两边都要保持这个页面开着。</p>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field-label">
                邀请码
                <em>服务端点「生成邀请码」后得到，以 DR1H: 开头</em>
              </span>
              <textarea
                className="remote-share remote-share-in"
                rows={4}
                value={inviteIn}
                onChange={(e) => setInviteIn(e.target.value)}
                placeholder="DR1H:…"
              />
            </label>
            <div className="remote-actions">
              <button
                className="btn btn-primary"
                onClick={() => void makeAnswer()}
                disabled={busy !== '' || !inviteIn.trim() || remote.mode === 'host' || !!hostSession}
              >
                {busy === 'client' ? '正在生成…' : '生成应答码'}
              </button>
            </div>
            <p className="muted small">
              直连不需要中继，也不需要 token；两台设备都先打开这个页面即可。跨公网时可能需要 STUN，网络严格时仍建议用中继。
            </p>
          </>
        )}
      </section>

      {msg && <p className="remote-ok small">{msg}</p>}
      {(err || remote.error) && <p className="lock-err">{err || remote.error}</p>}

      <p className="muted small">
        {remote.mode === 'host' && hostCfg
          ? '服务端关闭页面或断网后，客户端会自动回到自己的数据。'
          : '服务端与客户端之间的传输是明文的，只在可信局域网里使用。'}
      </p>
    </div>
  );
}
