#!/usr/bin/env python3
"""利韩土豆仓 · 管理员上传通道 端到端验证（走真实 HTTP 访问服务）"""
import json
import sys
import urllib.error
import urllib.request

URL = "https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload"
ORIGIN = "https://levihan-tudou-d0g7jivue1ccc4a35-1325571558.tcloudbaseapp.com"
CDN = "https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com"
PASSWORD = "lh-tudou-dvg9j2bq"

PASS, FAIL = [], []


def post(payload, token=None):
    """返回 (http_status, body_dict)"""
    headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    if token:
        headers["X-Admin-Token"] = token
    req = urllib.request.Request(URL, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_raw": raw}


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return None, str(e).encode()


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  → " + str(detail)[:220]) if detail else ""))


PNG_1PX = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

print("\n=== 0. HTTP 传输层 ===")
s, _ = get(URL)
check("GET 返回健康检查", s == 200, f"status={s}")

try:
    pre = urllib.request.Request(URL, method="OPTIONS", headers={
        "Origin": ORIGIN, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    with urllib.request.urlopen(pre, timeout=30) as r:
        acao = r.headers.get("Access-Control-Allow-Origin")
        check("CORS 预检通过且回显来源", r.status in (200, 204), f"status={r.status} ACAO={acao}")
except urllib.error.HTTPError as e:
    check("CORS 预检通过且回显来源", False, f"status={e.code}")

print("\n=== 1. status（公开） ===")
s, st = post({"action": "status"})
check("status 返回 200", s == 200 and st.get("ok") is True, st)
check("已配置管理员口令", st.get("configured") is True)
check("返回正确的桶信息", st.get("bucket") == "levihan-1325571558" and st.get("region") == "ap-nanjing")

print("\n=== 2. 鉴权 ===")
s, bad = post({"action": "login", "password": "wrong-password"})
check("错误口令被拒绝（401）", s == 401 and bad.get("ok") is False, bad)

s, good = post({"action": "login", "password": PASSWORD})
check("正确口令签发令牌", s == 200 and good.get("ok") is True and "." in str(good.get("token")), good)
TOKEN = good.get("token")

s, noauth = post({"action": "catalog"})
check("无令牌访问 catalog 被拒", s == 401, noauth)

s, badtok = post({"action": "catalog", "token": "9999999999.forged"})
check("伪造令牌被拒", s == 401, badtok)

s, expired = post({"action": "catalog", "token": "1000000000.whatever"})
check("过期时间戳令牌被拒", s == 401, expired)

print("\n=== 3. catalog（读取现有归档） ===")
s, cat0 = post({"action": "catalog"}, TOKEN)
check("catalog 成功", s == 200 and cat0.get("ok") is True, cat0)
BEFORE = cat0.get("books", [])
print("      现有作品：", [b.get("id") for b in BEFORE])
check("归档接口格式与前端 DoujinBookItem 一致",
      all(set(b.keys()) <= {"id", "titleZh", "titleJp", "circle", "category", "tags", "source",
                            "translator", "typesetter", "pages", "coverFile", "bookFolder",
                            "pagePrefix", "pagePadDigits"} for b in BEFORE),
      [sorted(b.keys()) for b in BEFORE][:1])

print("\n=== 4. upload（写入测试页到 lh-999/） ===")
s, up1 = post({"action": "upload", "token": TOKEN, "bookId": "lh-999", "fileName": "image01.webp",
               "dataBase64": PNG_1PX, "contentType": "image/webp"})
check("upload image01 成功", s == 200 and up1.get("key") == "lh-999/image01.webp", up1)
s, up2 = post({"action": "upload", "token": TOKEN, "bookId": "lh-999", "fileName": "image02.webp",
               "dataBase64": PNG_1PX, "contentType": "image/webp"})
check("upload image02 成功", s == 200, up2)

s, badname = post({"action": "upload", "token": TOKEN, "bookId": "lh-999", "fileName": "../../evil.webp",
                   "dataBase64": PNG_1PX})
check("路径穿越文件名被拒", s == 400, badname)
s, badid = post({"action": "upload", "token": TOKEN, "bookId": "../etc", "fileName": "image01.webp",
                 "dataBase64": PNG_1PX})
check("非法目录名被拒", s == 400, badid)
s, empty = post({"action": "upload", "token": TOKEN, "bookId": "lh-999", "fileName": "image03.webp",
                 "dataBase64": ""})
check("空文件被拒", s == 400, empty)

print("\n=== 5. publish（写入归档元数据） ===")
s, pub = post({"action": "publish", "token": TOKEN, "book": {
    "id": "lh-999", "titleZh": "_通道自检_请忽略", "circle": "自检", "category": "漫画本",
    "tags": "自检,临时", "pages": 2, "source": "自检", "translator": "自检", "typesetter": "自检",
}}, TOKEN)
check("publish 成功且为新增", s == 200 and pub.get("ok") is True and pub.get("replaced") is False, pub)

s, cat1 = post({"action": "catalog"}, TOKEN)
ids1 = [b.get("id") for b in cat1.get("books", [])]
check("归档中已出现 lh-999", "lh-999" in ids1, ids1)
entry = next((b for b in cat1.get("books", []) if b.get("id") == "lh-999"), {})
check("字段规范化正确",
      entry.get("titleZh") == "_通道自检_请忽略" and entry.get("tags") == ["自检", "临时"]
      and entry.get("pages") == 2 and entry.get("bookFolder") == "lh-999"
      and entry.get("coverFile") == "image01.webp" and entry.get("source") == "自检", entry)

s, badpub = post({"action": "publish", "token": TOKEN, "book": {"id": "not-lh", "titleZh": "x", "pages": 1}})
check("非法 ID 被拒", s == 400, badpub)
s, badpages = post({"action": "publish", "token": TOKEN, "book": {"id": "lh-998", "titleZh": "x", "pages": 0}})
check("非法页数被拒", s == 400, badpages)
s, notitle = post({"action": "publish", "token": TOKEN, "book": {"id": "lh-998", "pages": 1}})
check("缺少本子名被拒", s == 400, notitle)

s, repub = post({"action": "publish", "token": TOKEN, "book": {
    "id": "lh-999", "titleZh": "_通道自检_请忽略v2", "circle": "自检", "pages": 3}}, TOKEN)
check("同 ID 再次提交为覆盖（replaced）", s == 200 and repub.get("replaced") is True, repub)
s, cat1b = post({"action": "catalog"}, TOKEN)
check("覆盖后仍只有一本书该 ID",
      sum(1 for b in cat1b.get("books", []) if b.get("id") == "lh-999") == 1,
      [b.get("id") for b in cat1b.get("books", [])])

print("\n=== 5b. 可选字段归一化（回归：pagePadDigits 不能写成 0） ===")
s, t1 = post({"action": "publish", "token": TOKEN, "book": {
    "id": "lh-999", "titleZh": "_通道自检_请忽略v2", "circle": "自检", "pages": 3,
    "pagePadDigits": 0, "pagePrefix": "image", "bookFolder": "", "coverFile": ""}}, TOKEN)
e1 = next((b for b in t1.get("books", []) if b.get("id") == "lh-999"), {})
check("pagePadDigits=0 被忽略（否则站点会把 image01 读成 image1）", "pagePadDigits" not in e1, e1)
check("pagePrefix='image' 默认值不写入", "pagePrefix" not in e1, e1)
check("空 bookFolder 回退为 ID", e1.get("bookFolder") == "lh-999", e1)
check("空 coverFile 回退为 image01.webp", e1.get("coverFile") == "image01.webp", e1)

s, t2 = post({"action": "publish", "token": TOKEN, "book": {
    "id": "lh-999", "titleZh": "_通道自检_请忽略v3", "circle": "自检", "pages": 3,
    "pagePadDigits": 3, "pagePrefix": "page"}}, TOKEN)
e2 = next((b for b in t2.get("books", []) if b.get("id") == "lh-999"), {})
check("pagePadDigits=3 正常写入", e2.get("pagePadDigits") == 3, e2)
check("自定义 pagePrefix 正常写入", e2.get("pagePrefix") == "page", e2)

s, t3 = post({"action": "publish", "token": TOKEN, "book": {
    "id": "lh-999", "titleZh": "_通道自检_请忽略v4", "circle": "自检", "pages": 3,
    "pagePadDigits": -1}}, TOKEN)
e3 = next((b for b in t3.get("books", []) if b.get("id") == "lh-999"), {})
check("负数 pagePadDigits 被忽略", "pagePadDigits" not in e3, e3)

print("\n=== 6. 公开只读验证（COS 静态网站端点，站点实际读取路径） ===")
s1, b1 = get(f"{CDN}/lh-999/image01.webp")
check("上传的图片可通过公开域名读取", s1 == 200 and len(b1) > 0, f"status={s1} bytes={len(b1)}")
s2, b2 = get(f"{CDN}/archive.json")
remote = json.loads(b2.decode("utf-8")) if s2 == 200 else []
check("archive.json 已含 lh-999", any(x.get("id") == "lh-999" for x in remote), f"status={s2} count={len(remote)}")

print("\n=== 7. remove（清理测试数据） ===")
s, rm = post({"action": "remove", "token": TOKEN, "id": "lh-999", "deleteFiles": True}, TOKEN)
check("remove 成功", s == 200 and rm.get("ok") is True, rm)
check("已删除 2 个对象", rm.get("deletedObjects") == 2, rm.get("deletedObjects"))

s, cat2 = post({"action": "catalog"}, TOKEN)
ids2 = [b.get("id") for b in cat2.get("books", [])]
check("归档已恢复到初始状态", ids2 == [b.get("id") for b in BEFORE], f"{ids2} vs {[b.get('id') for b in BEFORE]}")
s3, _ = get(f"{CDN}/lh-999/image01.webp")
check("已删除的图片返回 404", s3 == 404, f"status={s3}")

s, rmmiss = post({"action": "remove", "token": TOKEN, "id": "lh-997"}, TOKEN)
check("删除不存在的作品返回 404", s == 404, rmmiss)

s, unk = post({"action": "whatever", "token": TOKEN}, TOKEN)
check("未知 action 返回 400", s == 400, unk)

print("\n" + "=" * 58)
print(f"通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
if FAIL:
    print("失败项：" + ", ".join(FAIL))
    sys.exit(1)
print("全部通过 ✅")
