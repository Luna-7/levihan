/**
 * argon2 探针函数：验证 @node-rs/argon2 在云函数（Nodejs18.15 / Linux x64）能否装上并运行。
 * 只做 require + hash + verify，不碰任何数据库/现有函数。
 */
exports.main = async (event) => {
  const result = { ok: false, steps: [] };
  try {
    const argon2 = require('@node-rs/argon2');
    result.steps.push({ step: 'require', ok: true });
    result.algorithmArgon2id = argon2.Algorithm.Argon2id;

    const hash = await argon2.hash('probe-password-123', {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    result.steps.push({ step: 'hash', ok: true, hashPrefix: hash.slice(0, 20) });

    const verifyOk = await argon2.verify(hash, 'probe-password-123');
    const verifyBad = await argon2.verify(hash, 'wrong');
    result.steps.push({ step: 'verify', ok: verifyOk === true && verifyBad === false, verifyOk, verifyBad });

    result.ok = true;
    result.message = 'argon2 native 模块在云函数中可用';
    result.process = { platform: process.platform, arch: process.arch, node: process.version };
  } catch (error) {
    result.ok = false;
    result.message = 'argon2 加载失败：' + String((error && error.stack) || error);
    result.error = String((error && error.message) || error);
  }
  return result;
};
