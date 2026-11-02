// 临时冒烟测试：从 core.js 抽取纯函数单独验证，不执行整文件
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/core.js', 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if(i < 0) throw new Error('not found: ' + name);
  // 从函数头开始，逐字符匹配大括号配对，取完整函数体
  let depth = 0, j = i, started = false;
  for(; j < src.length; j++){
    const c = src[j];
    if(c === '{'){ depth++; started = true; }
    else if(c === '}'){ depth--; if(started && depth === 0){ j++; break; } }
  }
  return src.slice(i, j);
}

const fns = ['parseApiResponse', 'normalizeMovieName', 'relevanceScore', 'sortResultList', 'searchCacheGet', 'searchCacheSet', 'searchCacheClear'];
const code = fns.map(grab).join('\n');

// 提供 sortResultList 依赖的 state 桩
const ctx = {
  state: { keyword: '咒术回战', resultSort: 'relevance' }
};
const run = new Function('state', code + `
;return {
  parseApiResponse, normalizeMovieName, relevanceScore, sortResultList,
  test: function(){
    const out = {};
    out.norm1 = normalizeMovieName('进击的巨人 第一季');
    out.norm2 = normalizeMovieName('葬送的芙莉莲（TV） 高清');
    out.norm3 = normalizeMovieName('咒术回战 第2季');
    out.scoreEq = relevanceScore({vod_name:'咒术回战'}, '咒术回战') === 100;
    out.scorePre = relevanceScore({vod_name:'咒术回战 第二季'}, '咒术回战') === 80;
    out.scoreInc = relevanceScore({vod_name:'剧场版 咒术回战0'}, '咒术回战') === 60;
    out.jsonp = parseApiResponse('callback({"list":[{"vod_name":"测试"}]})');
    out.varjsonp = parseApiResponse('var data = ({"list":[{"vod_name":"测试2"}]});');
    out.plain = parseApiResponse('{"list":[{"vod_name":"测试3"}]}');
    out.bom = parseApiResponse('\\uFEFF{"list":[{"vod_name":"测试4"}]}');
    const list = [
      {vod_name:'某电影', vod_year:'2019', vod_score:'9.2'},
      {vod_name:'咒术回战', vod_year:'2020', vod_score:'8.7'},
      {vod_name:'咒术回战 第二季', vod_year:'2023', vod_score:'8.9'}
    ];
    sortResultList(list);
    out.sortFirst = list[0].vod_name; // 应先是精确匹配的'咒术回战'
    state.resultSort = 'year';
    sortResultList(list);
    out.sortYearFirst = list[0].vod_name; // 最新 2023
    return out;
  }
}`);
const r = run(ctx).test();
console.log(JSON.stringify(r, null, 2));
const ok = r.norm1 === '进击的巨人' && r.norm2 === '葬送的芙莉莲' && r.norm3 === '咒术回战'
  && r.scoreEq && r.scorePre && r.scoreInc
  && r.jsonp && r.jsonp.list && r.jsonp.list[0].vod_name === '测试'
  && r.varjsonp && r.varjsonp.list[0].vod_name === '测试2'
  && r.plain.list[0].vod_name === '测试3'
  && r.bom.list[0].vod_name === '测试4'
  && r.sortFirst === '咒术回战' && r.sortYearFirst === '咒术回战 第二季';
console.log(ok ? 'SMOKE_TEST_PASS' : 'SMOKE_TEST_FAIL');
process.exit(ok ? 0 : 1);
