import cloudbaseSDK from '@cloudbase/js-sdk';

export const cloudbase = cloudbaseSDK.init({
  env: import.meta.env.VITE_CLOUDBASE_ENV_ID || 'levihan-tudou-d0g7jivue1ccc4a35',
  region: import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai',
});
