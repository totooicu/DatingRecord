// 复合值控件：经纬度 / 社交账号 / 自由 JSON
export function GeoField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const g = (value ?? {}) as { lat?: number; lng?: number };
  return (
    <span className="inline-field">
      <input
        type="number"
        step="0.000001"
        placeholder="纬度"
        value={g.lat ?? ''}
        onChange={(e) => onChange({ ...g, lat: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
      <input
        type="number"
        step="0.000001"
        placeholder="经度"
        value={g.lng ?? ''}
        onChange={(e) => onChange({ ...g, lng: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </span>
  );
}

export function SocialField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const s = (value ?? {}) as { platform?: string; handle?: string };
  return (
    <span className="inline-field">
      <input
        placeholder="平台"
        value={s.platform ?? ''}
        onChange={(e) => onChange({ ...s, platform: e.target.value || undefined })}
      />
      <input
        placeholder="账号"
        value={s.handle ?? ''}
        onChange={(e) => onChange({ ...s, handle: e.target.value || undefined })}
      />
    </span>
  );
}

export function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <textarea
      rows={3}
      value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value));
        } catch {
          onChange(e.target.value);
        }
      }}
    />
  );
}
