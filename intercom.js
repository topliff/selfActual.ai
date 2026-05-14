// Intercom widget — selfactual.ai
// App ID: pj52grij
// Launcher hidden: tracking-only until a user identifies via the waitlist form,
// at which point we call Intercom('update', { email }) to merge the session.

// First-touch attribution — captured once on first page view, never overwritten.
(function(){
  try {
    var KEY = 'sa_first_touch';
    if (!localStorage.getItem(KEY)) {
      var params = new URLSearchParams(location.search);
      var data = {
        landing_url: location.href,
        landing_path: location.pathname,
        referrer: document.referrer || null,
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        utm_content: params.get('utm_content'),
        utm_term: params.get('utm_term'),
        first_seen_at: new Date().toISOString()
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    }
  } catch (e) {}
})();

window.intercomSettings = {
  api_base: "https://api-iam.intercom.io",
  app_id: "pj52grij",
  hide_default_launcher: true
};

(function(){
  var w=window;var ic=w.Intercom;
  if(typeof ic==="function"){ic('reattach_activator');ic('update',w.intercomSettings);}
  else{
    var d=document;var i=function(){i.c(arguments);};
    i.q=[];i.c=function(args){i.q.push(args);};
    w.Intercom=i;
    var l=function(){
      var s=d.createElement('script');
      s.type='text/javascript';s.async=true;
      s.src='https://widget.intercom.io/widget/pj52grij';
      var x=d.getElementsByTagName('script')[0];
      x.parentNode.insertBefore(s,x);
    };
    if(document.readyState==='complete'){l();}
    else if(w.attachEvent){w.attachEvent('onload',l);}
    else{w.addEventListener('load',l,false);}
  }
})();

// Belt-and-suspenders: re-assert hide after widget boots, in case a workspace
// setting or stale cache tried to show the launcher.
window.Intercom('update', { hide_default_launcher: true });
