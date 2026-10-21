// 删除前的确认文案：把牵动面说全。
//
// 头像尤其要提——用户常常忘了「这张图还是某某的头像」，
// 等删完发现头像变成姓名首字，已经找不到原图了。
export function deleteHint(name: string, refs: number, avatars: string[]): string {
  if (refs + avatars.length === 0) return `删除「${name}」？`;
  const parts: string[] = [];
  if (refs) parts.push(`${refs} 个事件在正文里引用它`);
  if (avatars.length) parts.push(`${avatars.length} 个人物（${avatars.join('、')}）用它当头像`);
  return `删除「${name}」？${parts.join('，')}，那些位置会失效。`;
}
