// 导出：把整库打包成一个 .drp.json（纯文本、可 diff、可进 git）

import { queryAll, getDeviceId, getMeta, setMeta } from '../db';
import { newId } from '../id';
import { getBlob, blobToBase64 } from '../db/blob';
import { SCHEMA_VERSION, type Attachment, type LibraryFile } from '../types';
import {
  rowToDef,
  rowToPerson,
  rowToEvent,
  rowToCollection,
  rowToMember,
  rowToAttachment,
  rowToTemplate,
  type Row,
} from './mappers';

function ensureLibraryId(): string {
  const id = newId('lib');
  setMeta('library_id', id);
  return id;
}

export async function exportAttachments(): Promise<Attachment[]> {
  const rows = queryAll<Row>('SELECT * FROM attachments');
  const out: Attachment[] = [];
  for (const r of rows) {
    const meta = rowToAttachment(r);
    const blob = await getBlob(r.id);
    out.push({ ...meta, data: blob ? await blobToBase64(blob) : '' });
  }
  return out;
}

export async function buildLibrary(opts: { includeAttachments?: boolean } = {}): Promise<LibraryFile> {
  const defs = queryAll<Record<string, never>>('SELECT * FROM attribute_defs').map(rowToDef);
  const persons = queryAll<Record<string, never>>('SELECT * FROM persons').map(rowToPerson);
  const events = queryAll<Record<string, never>>('SELECT * FROM events').map(rowToEvent);
  const collections = queryAll<Record<string, never>>('SELECT * FROM collections').map(rowToCollection);
  const members = queryAll<Record<string, never>>('SELECT * FROM collection_members').map(rowToMember);
  const attachments = opts.includeAttachments ? await exportAttachments() : [];
  const templates = queryAll<Row>(
    'SELECT * FROM attribute_templates WHERE deleted_at IS NULL ORDER BY created_at ASC',
  ).map(rowToTemplate);

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      // 库 id 要落库：每次导出临时 newId 的话，同步时同一份数据会算出不同哈希
      id: getMeta('library_id') ?? ensureLibraryId(),
      name: getMeta('library_name') ?? '我的记录',
      exportedAt: new Date().toISOString(),
      app: 'DatingRecord/0.1.0',
      deviceId: getDeviceId(),
    },
    attributeDefs: defs,
    persons,
    attrHistory: queryAll<Row>('SELECT * FROM person_attr_history').map((r) => ({
      id: r.id,
      personId: r.person_id,
      key: r.attr_key,
      valueJson: r.value_json,
      changedAt: r.changed_at,
      byEventId: r.by_event_id ?? null,
      reason: r.reason ?? undefined,
    })),
    events,
    collections,
    members,
    attachments,
    templates,
  };
}

export async function exportToFile(opts: { includeAttachments?: boolean } = {}): Promise<string> {
  const lib = await buildLibrary(opts);
  const text = JSON.stringify(lib, null, 2);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dating-record-${stamp}.drp.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return a.download;
}
