// 库概览：人物（含归档）/ 事件 / 操作日志 / 数据库体积
import { useMemo } from 'react';
import { globalStats } from '../../core/repo/events';
import { getRoot } from '../../core/repo/collections';
import { dbSizeBytes } from '../../core/io';
import { queryOne } from '../../core/db';
import { SCHEMA_VERSION } from '../../core/types';
import { Section } from './Section';
import { useVersion } from '../../store';

export function OverviewSection() {
  const v = useVersion();
  const stats = useMemo(() => globalStats(), [v]);
  const sizeKb = useMemo(() => Math.round(dbSizeBytes() / 1024), [v]);
  const oplogCount = useMemo(() => queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM oplog')?.c ?? 0, [v]);

  return (
    <Section title="库概览">
      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-num">
            {stats.personCount}
            {stats.archivedPersonCount > 0 && <em className="stat-sub">+{stats.archivedPersonCount} 归档</em>}
          </span>
          <span className="stat-label">人物</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.eventCount}</span>
          <span className="stat-label">事件</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{oplogCount}</span>
          <span className="stat-label">操作日志</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{sizeKb} KB</span>
          <span className="stat-label">数据库</span>
        </div>
      </div>
      <p className="muted small">
        schema 版本 {SCHEMA_VERSION}　·　根集合 {getRoot()?.name ?? '—'}
        　·　操作日志是同步与撤销的基础，写操作会自动追加。
      </p>
    </Section>
  );
}
