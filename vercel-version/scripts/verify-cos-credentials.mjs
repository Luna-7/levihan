import { stdin, stdout } from 'node:process';
import { sts } from 'tencentcloud-sdk-nodejs-sts';

function readHidden(label) {
  if (!stdin.isTTY) throw new Error('请在交互式终端中运行。');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onData(chunk) {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('已取消。'));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    }
    stdin.on('data', onData);
  });
}

try {
  const secretId = (await readHidden('SecretId（隐藏输入）: ')).trim();
  const secretKey = (await readHidden('SecretKey（隐藏输入）: ')).trim();
  const client = new sts.v20180813.Client({
    credential: { secretId, secretKey },
    region: 'ap-nanjing',
    profile: { httpProfile: { endpoint: 'sts.tencentcloudapi.com', reqTimeout: 10 } },
  });
  await client.GetCallerIdentity(null);
  stdout.write('验证成功：这组密钥可调用腾讯云身份接口。\n');
} catch (error) {
  stdout.write(`验证失败：${error?.code || error?.name || 'UNKNOWN'}\n`);
  process.exitCode = 1;
}
