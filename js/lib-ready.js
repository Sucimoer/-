window.__libReady = (function(){
  var SOURCES = {
    hls: [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js',
      'https://unpkg.com/hls.js@1.5.7/dist/hls.min.js',
      'https://cdn.staticfile.org/hls.js/1.5.7/hls.min.js'
    ],
    supabase: [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
      'https://unpkg.com/@supabase/supabase-js@2',
      'https://cdn.staticfile.org/supabase-js/2.39.3/supabase.min.js'
    ]
  };
  function ok(key){
    return key === 'hls'
      ? (typeof window.Hls !== 'undefined')
      : (typeof window.supabase !== 'undefined');
  }
  function loadSeq(key){
    return new Promise(function(resolve){
      var urls = SOURCES[key], i = 0;
      (function next(){
        if(ok(key)) return resolve(true);
        if(i >= urls.length) return resolve(false);
        var s = document.createElement('script');
        s.src = urls[i++];
        s.async = false;
        s.onload = function(){ ok(key) ? resolve(true) : next(); };
        s.onerror = function(){
          if(s.parentNode) s.parentNode.removeChild(s);
          next();
        };
        document.head.appendChild(s);
      })();
    });
  }
  return Promise.all([loadSeq('hls'), loadSeq('supabase')]);
})();