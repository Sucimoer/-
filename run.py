import re
import json
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from urllib.parse import quote
import uvicorn

app = FastAPI(title="SakuraAV 终极简易版")

# 允许跨域（虽然合二为一后同源了，但加上没坏处）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_URL = "https://sakuraav.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": BASE_URL,
}

# ================== 前端页面（直接写在这里） ==================
HTML_PAGE = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>测试搜索播放</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/dplayer/dist/DPlayer.min.css">
<script src="https://cdn.jsdelivr.net/npm/dplayer/dist/DPlayer.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<style>
  body { font-family: sans-serif; padding: 20px; }
  #results { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
  .video-card { width: 160px; cursor: pointer; border: 1px solid #ddd; padding: 6px; border-radius: 6px; }
  .video-card img { width: 100%; height: 220px; object-fit: cover; }
  .video-card h3 { font-size: 14px; margin: 6px 0 0; }
  #dplayer { margin-top: 20px; max-width: 800px; }
</style>
</head>
<body>
  <h1>测试搜索</h1>
  <input id="searchInput" type="text" placeholder="输入关键词，如：进击的巨人" style="width:300px;padding:8px;">
  <button id="searchBtn" style="padding:8px 16px;">搜索</button>
  <div id="results"></div>
  <div id="dplayer"></div>

<script>
// 因为前后端在一起了，这里直接用相对路径，不用写端口了！
let dp = null;

async function searchAnime(keyword) {
  console.log('触发了搜索:', keyword);
  if (!keyword.trim()) return;
  try {
    const resp = await fetch(`/search?keyword=${encodeURIComponent(keyword)}`);
    const data = await resp.json();
    console.log('搜索结果:', data);
    renderResults(data.list || []);
  } catch (err) {
    console.error('搜索失败:', err);
    alert('搜索失败，看浏览器控制台');
  }
}

function renderResults(list) {
  const container = document.getElementById('results');
  if (!list.length) { container.innerHTML = '<p>没有找到结果</p>'; return; }
  container.innerHTML = list.map(item => `
    <div class="video-card" onclick="playVideo('${item.detail_url}')">
      <img src="${item.cover || 'https://via.placeholder.com/160x220'}" alt="${item.title}">
      <h3>${item.title}</h3>
    </div>
  `).join('');
}

async function playVideo(detailUrl) {
  try {
    const resp = await fetch(`/play?detail_url=${encodeURIComponent(detailUrl)}`);
    const data = await resp.json();
    console.log('播放地址:', data);
    if (!data.play_url) { alert('未找到播放地址'); return; }
    if (dp) dp.destroy();
    dp = new DPlayer({
      container: document.getElementById('dplayer'),
      video: {
        url: `/proxy?url=${encodeURIComponent(data.play_url)}`,
        type: data.type === 'hls' ? 'customHls' : 'normal',
        customType: {
          customHls: function(video) {
            const hls = new Hls();
            hls.loadSource(video.src);
            hls.attachMedia(video);
          }
        }
      },
    });
  } catch (err) {
    console.error('播放失败:', err);
    alert('播放失败，看控制台');
  }
}

document.getElementById('searchBtn').onclick = () => searchAnime(document.getElementById('searchInput').value);
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchAnime(e.target.value);
});
</script>
</body>
</html>
"""

# ================== 后端接口 ==================

@app.get("/", response_class=HTMLResponse)
def home():
    """直接返回前端网页"""
    return HTML_PAGE

@app.get("/search")
def search(keyword: str = Query(...)):
    encoded_kw = quote(keyword)
    search_url = f"{BASE_URL}/anime?q={encoded_kw}"
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=15)
        resp.encoding = "utf-8"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"请求失败: {e}")

    soup = BeautifulSoup(resp.text, "lxml")
    
    # 尝试从 __NEXT_DATA__ 提取
    next_data = soup.find("script", id="__NEXT_DATA__")
    if next_data and next_data.string:
        try:
            data = json.loads(next_data.string)
            props = data.get("props", {}).get("pageProps", {})
            candidates = props.get("list") or props.get("animes") or props.get("data") or []
            if isinstance(candidates, dict):
                candidates = candidates.get("list") or []
            items = []
            for item in candidates:
                if isinstance(item, dict) and item.get("title"):
                    slug = item.get("slug") or item.get("id") or ""
                    items.append({
                        "title": item.get("title"),
                        "detail_url": f"{BASE_URL}/anime/{slug}" if slug else "",
                        "cover": item.get("cover") or item.get("image") or ""
                    })
            if items:
                print(f"[DEBUG] 成功解析 {len(items)} 条结果")
                return {"keyword": keyword, "total": len(items), "list": items}
        except Exception as e:
            print(f"[DEBUG] JSON解析异常: {e}")

    # 备用：HTML解析
    results = []
    for card in soup.select("a[href*='/anime/']"):
        href = card.get("href", "")
        if any(x in href for x in ["/genres", "/rankings", "/schedule"]): continue
        title_el = card.select_one("h2, h3, .title")
        title = title_el.text.strip() if title_el else card.text.strip()
        if len(title) > 1:
            results.append({
                "title": title,
                "detail_url": f"{BASE_URL}{href}",
                "cover": ""
            })
    print(f"[DEBUG] HTML解析到 {len(results)} 条结果")
    return {"keyword": keyword, "total": len(results), "list": results[:30]}


@app.get("/play")
def play(detail_url: str = Query(...)):
    if not detail_url.startswith(BASE_URL):
        raise HTTPException(status_code=400, detail="URL 必须来自 sakuraav.com")
    try:
        resp = requests.get(detail_url, headers=HEADERS, timeout=15)
        resp.encoding = "utf-8"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"请求详情页失败: {e}")

    # 正则找 m3u8/mp4
    patterns = [r'"(https?://[^"]*\.m3u8[^"]*)"', r'"(https?://[^"]*\.mp4[^"]*)"']
    for pattern in patterns:
        matches = re.findall(pattern, resp.text)
        if matches:
            url = matches[0]
            return {"play_url": url, "type": "hls" if ".m3u8" in url else "mp4"}

    # 找 iframe
    soup = BeautifulSoup(resp.text, "lxml")
    iframe = soup.select_one("iframe[src]")
    if iframe:
        return {"play_url": iframe["src"], "type": "iframe"}

    raise HTTPException(status_code=404, detail="未找到播放地址")


@app.get("/proxy")
def proxy(url: str = Query(...)):
    proxy_headers = {**HEADERS, "Referer": BASE_URL}
    req = requests.get(url, headers=proxy_headers, stream=True, timeout=30)
    def stream():
        for chunk in req.iter_content(chunk_size=8192):
            if chunk: yield chunk
    return StreamingResponse(stream(), media_type=req.headers.get("Content-Type", "video/mp2t"))


if __name__ == "__main__":
    print("=========================================")
    print("启动成功！请用浏览器访问：http://127.0.0.1:8000")
    print("按 Ctrl+C 可以停止服务")
    print("=========================================")
    uvicorn.run(app, host="127.0.0.1", port=8000)