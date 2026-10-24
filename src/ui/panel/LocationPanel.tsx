// 功能面板 · 定位。
//
// 页面拆成四个切换区（借 AI 对话页那套分段切换条）：
//   地图 —— 轨迹、蓝点（当前位置）、黄点（文件记录）、红点（选中）
//   记录 —— 打点 / 自动打点 / 阈值 / 点位列表
//   文件 —— 新建 / 选择 / 导入 .drloc（兼容旧 CSV）/ 经纬度偏移修正
//   说明 —— 高德 key 与格式说明
//
// 数据与自动打点定时器在 core/runtime/locationAuto.ts 单例里：
// 离开本页照样打点（服务语义），本页只是订阅式视图 + 地图渲染。

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FilePickInput } from '../common';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';
import { bump } from '../../store';
import { createLocation, importLocationText, readLocation } from '../../core/location/locationFile';
import { applyOffset } from '../../core/location/format';
import {
  getAmapKey,
  locateMe as locateOnce,
  openLocationFile,
  punch,
  setAmapKey,
  setLocationOffset,
  setThreshold,
  startAuto,
  stopAuto,
  useLocationAuto,
} from '../../core/runtime/locationAuto';

type TabKey = 'map' | 'record' | 'file' | 'help';

/** 线宽 4 → 点直径 2×线粗 = 8；蓝/黄/红都同一尺寸，只靠颜色区分 */
const LINE_WEIGHT = 4;
const DOT_SIZE = LINE_WEIGHT * 2;
const COLOR_LINE = '#FFC107';
const COLOR_POINT = '#FFC107';
const COLOR_CURRENT = '#2196F3';
const COLOR_SELECTED = '#E53935';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function dotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${DOT_SIZE}px;height:${DOT_SIZE}px;border-radius:50%;background:${color};box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
    iconSize: [DOT_SIZE, DOT_SIZE],
    iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
  });
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'map', label: '地图' },
  { key: 'record', label: '记录' },
  { key: 'file', label: '文件' },
  { key: 'help', label: '说明' },
];

export function LocationPanel() {
  const la = useLocationAuto();
  const { fileId, fileName, rows, offset, current, threshold, running: auto, busy } = la;
  const corrected = useMemo(() => applyOffset(rows, offset), [rows, offset]);

  const [tab, setTab] = useState<TabKey>('map');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [offsetLat, setOffsetLat] = useState('0');
  const [offsetLng, setOffsetLng] = useState('0');
  const [amapKey, setAmapKeyState] = useState(getAmapKey);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** 已经对哪个文件做过 fitBounds：自动打点持续加点时不再反复缩放 */
  const fittedFile = useRef<string | null>(null);

  const saveText =
    la.saving === 'saving'
      ? '保存中…'
      : la.saving === 'error'
        ? '保存失败'
        : la.saving === 'saved'
          ? '已保存'
          : '自动保存';

  // 偏移输入框跟当前文件同步（保存偏移后回填规范化后的数值）
  useEffect(() => {
    setOffsetLat(String(offset.lat));
    setOffsetLng(String(offset.lng));
  }, [fileId, offset.lat, offset.lng]);

  useEffect(() => {
    setSelectedIdx(null);
    fittedFile.current = null;
  }, [fileId]);

  // 初始化地图（只一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([30.2741, 120.1551], 12);
    mapRef.current = map;
    L.control.scale({ imperial: false, metric: true }).addTo(map);
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '© 高德地图' },
    ).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }, []);

  // 切回地图页时补一次尺寸计算：隐藏期间容器宽高是 0
  useEffect(() => {
    if (tab !== 'map') return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [tab]);

  // 数据变化重画图层
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    if (corrected.length > 1) {
      L.polyline(
        corrected.map((r) => [r.lat, r.lng] as [number, number]),
        { color: COLOR_LINE, weight: LINE_WEIGHT, opacity: 0.75 },
      ).addTo(map);
    }

    corrected.forEach((r, i) => {
      const color = i === selectedIdx ? COLOR_SELECTED : COLOR_POINT;
      L.marker([r.lat, r.lng], { icon: dotIcon(color) })
        .addTo(map)
        .on('click', () => setSelectedIdx(i))
        .bindPopup(
          `<div><strong>${esc(fmtTime(r.ts))}</strong><br/>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}` +
            `${r.accuracy ? `<br/>±${Math.round(r.accuracy)}m` : ''}${r.note ? `<br/>${esc(r.note)}` : ''}</div>`,
        );
    });

    // 蓝点最后画，压在历史点上面；它不属于文件，只表示「现在在哪」
    if (current) {
      L.marker([current.lat, current.lng], { icon: dotIcon(COLOR_CURRENT) })
        .addTo(map)
        .bindPopup(
          `<div><strong>当前位置</strong><br/>${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}` +
            `${current.accuracy ? `<br/>±${Math.round(current.accuracy)}m` : ''}</div>`,
        );
    }

    if (corrected.length > 0 && fittedFile.current !== fileId) {
      fittedFile.current = fileId;
      map.fitBounds(L.latLngBounds(corrected.map((r) => [r.lat, r.lng] as [number, number])).pad(0.2));
    }
  }, [corrected, selectedIdx, current, fileId]);

  const selectPoint = (idx: number) => {
    setSelectedIdx(idx);
    const p = corrected[idx];
    if (p) mapRef.current?.setView([p.lat, p.lng], 16);
    setTab('map');
  };

  const openExisting = async (f: { id: string; name: string }) => {
    try {
      const doc = await readLocation(f.id);
      openLocationFile(f.id, f.name, doc);
      setPicking(false);
      setTab('record');
      toast(`已打开「${f.name}」，${doc.points.length} 个点`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const createNew = async () => {
    try {
      const f = await createLocation({ name: newName.trim() || '定位记录' });
      const doc = await readLocation(f);
      openLocationFile(f.id, f.name, doc);
      setNewName('');
      setTab('record');
      bump();
      toast(`已创建「${f.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const saved = await importLocationText(await f.text(), f.name);
      const doc = await readLocation(saved);
      openLocationFile(saved.id, saved.name, doc);
      setTab('record');
      bump();
      toast(`已导入「${saved.name}」，${doc.points.length} 个点`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const record = async () => {
    if (!fileId) {
      toast('先选或新建一个定位文件');
      setTab('file');
      return;
    }
    try {
      const r = await punch(note);
      setNote('');
      if (r) {
        setSelectedIdx(r.index);
        mapRef.current?.setView([r.point.lat + offset.lat, r.point.lng + offset.lng], 16);
        toast('已记录并保存');
      }
    } catch (e) {
      toast(`定位失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const locateMe = () => {
    locateOnce()
      .then((fix) => {
        if (fix) mapRef.current?.setView([fix.lat, fix.lng], 16);
        else toast('定位失败');
      })
      .catch(() => toast('定位失败'));
  };

  const saveOffset = async () => {
    const lat = Number(offsetLat);
    const lng = Number(offsetLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast('偏移要填数字（单位：度）');
      return;
    }
    try {
      await setLocationOffset({ lat, lng });
      toast('经纬度偏移已写入文件');
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const saveKey = () => {
    setAmapKey(amapKey);
    toast('高德 key 已保存');
  };

  const selected = selectedIdx !== null ? corrected[selectedIdx] : null;

  return (
    <div className="loc-panel">
      <div className="aichat-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'record' && rows.length > 0 && <span className="aichat-tab-n">{rows.length}</span>}
          </button>
        ))}
      </div>

      {/* ---------- 地图 ---------- */}
      <div className="loc-view" hidden={tab !== 'map'}>
        <div className="loc-legend">
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_CURRENT }} />当前位置</span>
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_POINT }} />文件记录</span>
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_SELECTED }} />选中</span>
          <span className="muted small">{rows.length} 个点</span>
        </div>
        <div ref={containerRef} className="map-leaflet loc-map" />
        <div className="music-add">
          <button className="music-add-btn" onClick={locateMe}>定位到我的位置</button>
          <button className="music-add-btn" onClick={() => setTab('record')}>去记录</button>
        </div>
        {selected ? (
          <div className="loc-card">
            <div className="loc-card-head">
              <strong>选中的点</strong>
              <span className="muted small">{fmtTime(selected.ts)}</span>
            </div>
            <div className="loc-coord">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</div>
            <div className="muted small">
              {selected.accuracy ? `±${Math.round(selected.accuracy)}m` : '精度未知'}
              {selected.note ? ` · ${selected.note}` : ''}
            </div>
          </div>
        ) : (
          <p className="muted small">点地图上的黄点可查看坐标；红点表示当前选中。</p>
        )}
      </div>

      {/* ---------- 记录 ---------- */}
      <div className="loc-view" hidden={tab !== 'record'}>
        {!fileId ? (
          <div className="loc-empty">
            <p>还没有选择定位文件。</p>
            <button className="music-add-btn primary" onClick={() => setTab('file')}>去选择 / 新建</button>
          </div>
        ) : (
          <>
            <div className="loc-card">
              <div className="loc-card-head">
                <strong>{fileName}</strong>
                <span className={la.saving === 'error' ? 'music-save-state is-error' : 'music-save-state'}>{saveText}</span>
              </div>
              <div className="muted small">
                {rows.length} 个点 · 偏移 Δ{offset.lat.toFixed(6)}, Δ{offset.lng.toFixed(6)}
              </div>
            </div>

            <input
              className="music-name-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注（可选，手动打点时带上）"
            />
            <div className="music-add">
              <button className="music-add-btn primary" onClick={record} disabled={busy || auto}>
                {busy ? '定位中…' : '记录位置'}
              </button>
              <button className="music-add-btn" onClick={locateMe}>我的位置</button>
              <button className="music-add-btn" onClick={() => setTab('file')}>切换文件</button>
            </div>

            <div className="loc-row">
              <label className="muted small">
                去重阈值
                <input
                  type="number"
                  min={0}
                  className="loc-num"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                />
                米
              </label>
              {auto ? (
                <button className="music-add-btn" onClick={stopAuto}>⏹ 停止自动打点</button>
              ) : (
                <button
                  className="music-add-btn primary"
                  onClick={() => {
                    if (!startAuto()) toast('先选或新建一个定位文件');
                  }}
                >
                  ▶ 自动打点
                </button>
              )}
            </div>

            <ul className="music-list loc-list">
              {rows.length === 0 && <li className="muted small">打点会出现在地图上。</li>}
              {corrected
                .slice()
                .reverse()
                .map((r, i) => {
                  const realIdx = corrected.length - 1 - i;
                  const isSel = realIdx === selectedIdx;
                  return (
                    <li
                      key={`${r.ts}-${realIdx}`}
                      className={`music-row${isSel ? ' on' : ''}`}
                      onClick={() => selectPoint(realIdx)}
                    >
                      <span className="music-row-idx">{realIdx + 1}</span>
                      <span className="music-row-name">
                        {fmtTime(r.ts)} · {r.lat.toFixed(6)},{r.lng.toFixed(6)}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                      <span className="music-row-size muted small">±{Math.round(r.accuracy)}m</span>
                    </li>
                  );
                })}
            </ul>
          </>
        )}
      </div>

      {/* ---------- 文件 ---------- */}
      <div className="loc-view" hidden={tab !== 'file'}>
        {picking ? (
          <>
            <div className="music-pick-back">
              <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回</button>
              <span className="muted small">点文件即可打开</span>
            </div>
            <FilesPanel onPick={(f) => void openExisting(f)} onlyKinds={['location']} pickLabel="打开" compact />
          </>
        ) : (
          <>
            <div className="loc-card">
              <div className="loc-card-head">
                <strong>{fileId ? fileName : '未选择定位文件'}</strong>
                <span className="muted small">{rows.length} 个点</span>
              </div>
              <p className="muted small">
                定位数据保存在文件库的 <code>.drloc</code> 文件里，可按「定位」类型筛选、随备份同步。
              </p>
              {fileId && (
                <button className="music-add-btn" onClick={() => openLocationFile(null, '', null)}>
                  关闭当前文件
                </button>
              )}
            </div>

            <div className="loc-row">
              <input
                className="music-name-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新文件名（默认 定位记录）"
              />
              <button className="music-add-btn primary" onClick={createNew}>新建</button>
            </div>
            <div className="music-add">
              <button className="music-add-btn" onClick={() => setPicking(true)}>选已有定位文件</button>
              <button className="music-add-btn" onClick={() => importRef.current?.click()}>导入 .drloc / 旧 CSV</button>
            </div>
            <FilePickInput
              inputRef={importRef}
              accept=".drloc,application/x-dr-location,.csv,text/csv"
              onFiles={(files) => void importFile(files)}
            />

            <div className="loc-card">
              <div className="loc-card-head">
                <strong>经纬度偏移</strong>
                <span className="muted small">单位：度</span>
              </div>
              <p className="muted small">
                偏移会写进 <code>.drloc</code> 文件并加到所有点上：正值向北 / 向东。用于修正底图或导入数据的整体偏差。
              </p>
              <div className="loc-offset">
                <label>
                  纬度 Δ
                  <input
                    className="music-name-input"
                    inputMode="decimal"
                    value={offsetLat}
                    onChange={(e) => setOffsetLat(e.target.value)}
                    placeholder="0.000000"
                  />
                </label>
                <label>
                  经度 Δ
                  <input
                    className="music-name-input"
                    inputMode="decimal"
                    value={offsetLng}
                    onChange={(e) => setOffsetLng(e.target.value)}
                    placeholder="0.000000"
                  />
                </label>
              </div>
              <div className="music-add">
                <button className="music-add-btn primary" onClick={saveOffset} disabled={!fileId || la.saving === 'saving'}>
                  保存偏移
                </button>
                <button
                  className="music-add-btn"
                  onClick={() => {
                    setOffsetLat('0');
                    setOffsetLng('0');
                  }}
                  disabled={!fileId}
                >
                  归零
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---------- 说明 ---------- */}
      <div className="loc-view" hidden={tab !== 'help'}>
        <div className="loc-card">
          <div className="loc-card-head">
            <strong>高德 Web key</strong>
            <span className="muted small">只存本机</span>
          </div>
          <div className="loc-row">
            <input
              type="password"
              className="music-name-input"
              value={amapKey}
              onChange={(e) => setAmapKeyState(e.target.value)}
              placeholder="高德 Web 服务 key"
            />
            <button className="music-add-btn" onClick={saveKey}>保存</button>
          </div>
          <p className="muted small">不填也能用：会退回浏览器原生定位，精度略低。</p>
        </div>

        <div className="loc-card">
          <strong>文件与偏移</strong>
          <p className="muted small">
            <code>.drloc</code> 是应用自己的定位格式（JSON），里面保存点的时间、经纬度、精度、备注，
            以及这个文件整体的经纬度偏移。旧版 CSV 可以通过「导入」转成 <code>.drloc</code>，
            原 CSV 不会被改写。
          </p>
          <p className="muted small">
            自动打点是后台服务：离开本页仍会按阈值继续记录，回到页面即可看到新增的点。
          </p>
        </div>
      </div>
    </div>
  );
}
