// ---------------------------------------------------------------------------
// Built-in blocking rules. Everything is matched on the request hostname, by
// exact match or by domain suffix, so the lookup stays O(labels) per request.
// No network fetches, no remote list updates -> nothing leaks, nothing stalls.
// ---------------------------------------------------------------------------

/** Advertising / ad-delivery networks. */
export const AD_DOMAINS = [
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adservice.google.com',
  'pagead2.googlesyndication.com', 'partner.googleadservices.com', 'admob.com', 'adsystem.com',
  'amazon-adsystem.com', 'adnxs.com', 'adnxs-simple.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'revcontent.com',
  'mgid.com', 'zergnet.com', 'adroll.com', 'adsrvr.org', 'casalemedia.com', 'smartadserver.com',
  'sharethrough.com', 'teads.tv', 'spotxchange.com', 'spotx.tv', 'yieldmo.com', 'indexww.com',
  'contextweb.com', 'bidswitch.net', 'gumgud.com', 'gumgum.com', 'districtm.io', 'sonobi.com',
  'triplelift.com', 'lijit.com', 'sovrn.com', 'media.net', 'adform.net', 'adformdsp.net',
  'appnexus.com', 'improvedigital.com', 'onetag-sys.com', 'rhythmone.com', 'undertone.com',
  'yieldlab.net', 'adition.com', 'adscale.de', 'stroeerdigitalgroup.de', 'yieldbot.com',
  'nativo.com', 'ntv.io', 'servebom.com', 'ads-twitter.com', 'ads.linkedin.com', 'advertising.com',
  'adtechus.com', 'adtech.de', 'atwola.com', 'bluekai.com', 'exelator.com', 'eyeota.net',
  'mathtag.com', 'mediamath.com', 'turn.com', 'tremorhub.com', 'unrulymedia.com', 'zedo.com',
  'propellerads.com', 'popads.net', 'popcash.net', 'adcash.com', 'exoclick.com', 'exosrv.com',
  'juicyads.com', 'trafficjunky.net', 'adsterra.com', 'hilltopads.net', 'clickadu.com',
  'admaven.com', 'monetag.com', 'onclickalgo.com', 'onclicksuper.com', 'vidoomy.com',
  'ad.doubleclick.net', 'static.doubleclick.net', 'securepubads.g.doubleclick.net',
  'yandex-ads.com', 'an.yandex.ru', 'ads.yandex.ru', 'adfox.ru', 'vk-ads.net', 'ads.vk.com',
  'buysellads.com', 'carbonads.net', 'ezoic.net', 'ezojs.com', 'mediavine.com', 'adthrive.com',
  'playwire.com', 'sekindo.com', 'adblade.com', 'adsafeprotected.com', 'moatads.com',
  'serving-sys.com', 'flashtalking.com', 'sizmek.com', 'innovid.com', '2mdn.net'
]

/** Analytics / behaviour tracking / session recording. */
export const TRACKER_DOMAINS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com',
  'ssl.google-analytics.com', 'stats.g.doubleclick.net', 'segment.com', 'segment.io',
  'cdn.segment.com', 'mixpanel.com', 'amplitude.com', 'api.amplitude.com', 'heap.io',
  'heapanalytics.com', 'fullstory.com', 'hotjar.com', 'hotjar.io', 'static.hotjar.com',
  'mouseflow.com', 'crazyegg.com', 'luckyorange.com', 'inspectlet.com', 'smartlook.com',
  'quantserve.com', 'quantcount.com', 'scorecardresearch.com', 'comscore.com', 'chartbeat.com',
  'chartbeat.net', 'parsely.com', 'newrelic.com', 'nr-data.net', 'bugsnag.com', 'sentry-cdn.com',
  'branch.io', 'app-measurement.com', 'firebase-settings.crashlytics.com', 'crashlytics.com',
  'facebook.net', 'connect.facebook.net', 'pixel.facebook.com', 'graph.facebook.com',
  'analytics.tiktok.com', 'ads.tiktok.com', 'business-api.tiktok.com', 'analytics.twitter.com',
  't.co', 'static.ads-twitter.com', 'analytics.snapchat.com', 'sc-static.net', 'tr.snapchat.com',
  'px.ads.linkedin.com', 'snap.licdn.com', 'bat.bing.com', 'clarity.ms', 'c.clarity.ms',
  'yandex.ru/metrika', 'mc.yandex.ru', 'metrika.yandex.ru', 'top-fwz1.mail.ru', 'top100.rambler.ru',
  'matomo.cloud', 'kissmetrics.com', 'kissmetrics.io', 'optimizely.com', 'omtrdc.net',
  'demdex.net', 'everesttech.net', 'adobedtm.com', '2o7.net', 'sc.omtrdc.net',
  'tealiumiq.com', 'krxd.net', 'agkn.com', 'rlcdn.com', 'crwdcntrl.net', 'bounceexchange.com',
  'sharethis.com', 'addthis.com', 'addtoany.com', 'disqus.com/embed', 'zopim.com',
  'intercom.io', 'intercomcdn.com', 'drift.com', 'driftt.com', 'hubspot.com/__ptq.gif',
  'hs-analytics.net', 'hs-banner.com', 'hsforms.net', 'marketo.net', 'mktoresp.com',
  'pardot.com', 'clicktale.net', 'decibelinsight.net', 'contentsquare.net', 'quantummetric.com',
  'onesignal.com', 'pushcrew.com', 'pushengage.com', 'pushwoosh.com', 'wootric.com',
  'yieldify.com', 'exponea.com', 'braze.com', 'appboycdn.com', 'iterable.com', 'customer.io',
  'usabilla.com', 'qualtrics.com', 'siteimproveanalytics.com', 'statcounter.com', 'histats.com',
  'openstat.net', 'liveinternet.ru', 'cxense.com', 'permutive.com', 'lytics.io', 'zeotap.com',
  'id5-sync.com', 'idsync.rlcdn.com', 'pippio.com', 'tapad.com', 'adsymptotic.com'
]

/** Cryptominers and abusive background compute. */
export const CRYPTO_DOMAINS = [
  'coinhive.com', 'coin-hive.com', 'jsecoin.com', 'crypto-loot.com', 'cryptoloot.pro',
  'coinimp.com', 'webminepool.com', 'minero.cc', 'authedmine.com', 'coinpot.co', 'cpufan.club',
  'monerominer.rocks', 'webmine.cz', 'papoto.com', 'reasedoper.pw', 'mataharirama.xyz',
  'listat.biz', 'minecrunch.co', 'minemytraffic.com', 'ppoi.org', 'projectpoi.com',
  'cryptonight.wasm', 'nfwebminer.com', 'webminerpool.com', 'freecontent.stream'
]

/** URL query parameters that only exist to identify the visitor. */
export const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'utm_cid', 'utm_reader', 'utm_referrer', 'utm_social', 'utm_social-type', 'utm_brand',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gcl_au',
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
  'msclkid', 'yclid', 'ysclid', '_openstat', 'igshid', 'igsh', 'ttclid', 'twclid', 'ScCid',
  'mc_cid', 'mc_eid', 'ml_subscriber', 'ml_subscriber_hash', 'vero_conv', 'vero_id',
  'oly_anon_id', 'oly_enc_id', '_hsenc', '_hsmi', 'hsCtaTracking', '__hssc', '__hstc', '__hsfp',
  'mkt_tok', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid', 'ref_src', 'ref_url',
  'spm', 'scm', 'algo_pvid', 'aff_platform', 'aff_trace_key', 'terminal_id',
  'irclickid', 'irgwc', 'rb_clickid', 'wickedid', 'cjevent', 'epik', 'pk_campaign', 'pk_kwd'
]

/** Hosts we never touch even if a list would match — breaking these breaks the web. */
export const ALLOW_LIST = [
  'accounts.google.com', 'apis.google.com', 'www.google.com/recaptcha', 'recaptcha.net',
  'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'youtube.com', 'ytimg.com',
  'facebook.com/plugins', 'paypal.com', 'paypalobjects.com', 'stripe.com', 'js.stripe.com',
  'hcaptcha.com', 'cloudflare.com', 'challenges.cloudflare.com', 'sentry.io'
]

/**
 * Suffix matcher: "a.b.example.com" hits a rule for "example.com" but never a
 * rule for "ample.com". Rules containing a path fragment are matched on the
 * full "host/path" string instead.
 */
export class DomainMatcher {
  private hosts = new Set<string>()
  private paths: string[] = []

  constructor(rules: string[] = []) {
    this.add(rules)
  }

  add(rules: string[]) {
    for (const rule of rules) {
      const r = rule.toLowerCase().replace(/^\./, '')
      if (r.includes('/')) this.paths.push(r)
      else this.hosts.add(r)
    }
    return this
  }

  matches(hostname: string, pathname = ''): boolean {
    const host = hostname.toLowerCase()
    if (this.hosts.has(host)) return true
    let idx = host.indexOf('.')
    while (idx !== -1) {
      if (this.hosts.has(host.slice(idx + 1))) return true
      idx = host.indexOf('.', idx + 1)
    }
    if (this.paths.length) {
      const full = host + pathname.toLowerCase()
      for (const p of this.paths) if (full.includes(p)) return true
    }
    return false
  }

  get size() {
    return this.hosts.size + this.paths.length
  }
}
