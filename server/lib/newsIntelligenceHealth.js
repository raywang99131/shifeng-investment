export function assertNewsChannelsAvailable(results) {
  const successfulChannels = results.filter((result) => result?.ok).map((result) => result.channel);
  const failedChannels = results.filter((result) => !result?.ok).map((result) => result?.channel || 'unknown');

  if (results.length > 0 && successfulChannels.length === 0) {
    throw new Error(`新闻采集器不可用：${failedChannels.length} 个内容渠道全部失败（${failedChannels.slice(0, 4).join('、')}）`);
  }

  return { successfulChannels, failedChannels };
}
