// 删除前的确认文案：把牵动面说全。
//
// 头像尤其要提——用户常常忘了「这张图还是某某的头像」，
// 等删完发现头像变成姓名首字，已经找不到原图了。
// 事件集图标同理（F-C08）：图标位会退回成集合名首字。
export function deleteHint(name: string, refs: number, avatars: string[], icons: string[] = []): string {
  if (refs + avatars.length + icons.length === 0) return `删除「${name}」？`;
  const parts: string[] = [];
  if (refs) parts.push(`${refs} 个事件在正文里引用它`);
  if (avatars.length) parts.push(`${avatars.length} 个人物（${avatars.join('、')}）用它当头像`);
  if (icons.length) parts.push(`${icons.length} 个事件集（${icons.join('、')}）用它当图标`);
  return `删除「${name}」？${parts.join('，')}，那些位置会失效。`;
}
