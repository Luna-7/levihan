export async function submitToInbox(
  action: 'submitNovel' | 'submitContact' | 'submitAnnouncement' | 'submitRecommend',
  fields: Record<string, unknown>
) {
  void action; void fields;
  throw new Error('旧收件箱已停止写入；请使用“投稿”入口保存草稿并提交审核');
}
