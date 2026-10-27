# Vercel 用量与上传台负载

核对日期：2026-10-27

## 官方套餐额度

Vercel Hobby 免费套餐每月包含 100 GB Fast Data Transfer、1,000,000 次 CDN 请求、1,000,000 次函数调用、4 小时 Active CPU、360 GB-hrs Provisioned Memory，以及最多 10 GB Fast Origin Transfer。超过免费额度后，Hobby 项目可能暂停，通常需要等额度周期重置。Hobby 仅供个人非商业用途；Vercel 的 Fair Use Guidelines 明确说明，单纯请求捐赠不属于商业用途。

Pro 当前为 $20/月，含 $20 用量抵扣；超出包含额度后可按量计费，并可设置支出管理。

## 本项目的用量路径

- 上传台脚本和页面由 Vercel 静态托管，计入数据传输。浏览器下载和执行脚本、创建漫画卡片的 CPU 与内存消耗发生在访问者设备上。
- 漫画与小说文件由浏览器直接上传 COS，漫画封面也从 COS 加载，大文件流量不经过 Vercel。
- Vercel Function 处理登录、状态、目录与元数据等请求。当前目录接口会从 COS 读取并解析完整 `archive.json`，再将完整目录返回浏览器。因此目录 JSON 的体积和打开管理台的次数，才是本项目较值得关注的 Vercel 用量。

若只有少量管理员使用，函数调用和算力预计远低于 Hobby 额度；公开站点流量则需结合 Vercel Usage 页面的实际 Fast Data Transfer 与 Origin Transfer 判断。当前无法从本地环境读取线上归档体积或账户用量，故此为按代码路径和官方额度得出的估算，不是账户账单核验。

## 来源

- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Vercel CDN pricing and usage](https://vercel.com/docs/manage-cdn-usage)
- [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel Pro Plan](https://vercel.com/docs/plans/pro-plan)
- [Vercel Pricing](https://vercel.com/pricing)
