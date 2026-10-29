// 设置页通用卡片外壳 + 时间格式化

export function Section({
  title,
  desc,
  children,
}: {
  /** 子页标题可省：head 已经写了本页名字时，再来一行就是重复占位 */
  title?: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <h4 className="card-title">{title}</h4>
        </div>
      )}
      {desc && <p className="muted">{desc}</p>}
      {children}
    </section>
  );
}

export function fmtMeta(iso: string | null): string {
  if (!iso) return '从未';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
