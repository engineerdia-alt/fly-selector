// Float / launch helpers for Fly Finder (browser + Node tests).

var KAYAK_PADDLE_MPH = 3;

function haversineMi(lat1, lon1, lat2, lon2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLon = (lon2 - lon1) * toRad;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isLaunchKind(kind) {
  if (!kind) return false;
  return /launch|slipway|canoe|kayak|put.?in|boat/i.test(kind);
}

/** Sort launches roughly downstream (south/east bias for Midwest rivers). */
function sortLaunchesDownstream(spots) {
  return (spots || [])
    .filter(function (s) {
      return s && s.lat != null && s.lon != null && isLaunchKind(s.kind);
    })
    .slice()
    .sort(function (a, b) {
      // Prefer southbound (decreasing lat), then eastbound (increasing lon)
      var dLat = b.lat - a.lat;
      if (Math.abs(dLat) > 0.01) return dLat > 0 ? 1 : -1;
      return a.lon - b.lon;
    });
}

function estimateFloatHours(miles, mph) {
  var speed = mph || KAYAK_PADDLE_MPH;
  if (!miles || miles <= 0 || !speed) return null;
  return Math.round((miles / speed) * 10) / 10;
}

function formatFloatDuration(hours) {
  if (hours == null) return '';
  if (hours < 1) return Math.round(hours * 60) + ' min';
  var h = Math.floor(hours);
  var m = Math.round((hours - h) * 60);
  if (!m) return h + (h === 1 ? ' hr' : ' hrs');
  return h + ' hr ' + m + ' min';
}

/**
 * Build put-in → take-out legs between consecutive launches.
 * Caps at maxLegs to keep the UI readable.
 */
function buildFloatLegs(access, maxLegs) {
  var launches = sortLaunchesDownstream(access);
  var lim = maxLegs == null ? 5 : maxLegs;
  var legs = [];
  for (var i = 0; i < launches.length - 1 && legs.length < lim; i++) {
    var a = launches[i];
    var b = launches[i + 1];
    var miles = Math.round(haversineMi(a.lat, a.lon, b.lat, b.lon) * 10) / 10;
    if (miles < 0.4) continue; // skip near-duplicate pins
    var hours = estimateFloatHours(miles);
    legs.push({
      from: a,
      to: b,
      miles: miles,
      hours: hours,
      durationLabel: formatFloatDuration(hours),
      mapsDirUrl: googleMapsDirUrl(a.lat, a.lon, b.lat, b.lon),
      putInMapsUrl: googleMapsPlaceUrl(a.lat, a.lon),
      takeOutMapsUrl: googleMapsPlaceUrl(b.lat, b.lon)
    });
  }
  return legs;
}

function googleMapsPlaceUrl(lat, lon) {
  return 'https://www.google.com/maps/?q=' + lat + ',' + lon;
}

function googleMapsDirUrl(lat1, lon1, lat2, lon2) {
  return (
    'https://www.google.com/maps/dir/?api=1&origin=' +
    lat1 +
    ',' +
    lon1 +
    '&destination=' +
    lat2 +
    ',' +
    lon2 +
    '&travelmode=driving'
  );
}

/** Multi-pin search URL — opens Google Maps covering all launches. */
function googleMapsMultiSearchUrl(spots, queryPrefix) {
  var launches = sortLaunchesDownstream(spots);
  if (!launches.length) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent((queryPrefix || 'kayak launch') + '')
    );
  }
  if (launches.length === 1) {
    return googleMapsPlaceUrl(launches[0].lat, launches[0].lon);
  }
  // Directions with waypoints shows every launch as a stop (viewable / shareable)
  var origin = launches[0].lat + ',' + launches[0].lon;
  var dest =
    launches[launches.length - 1].lat + ',' + launches[launches.length - 1].lon;
  var mids = launches.slice(1, -1).slice(0, 8);
  var wp = mids
    .map(function (s) {
      return s.lat + ',' + s.lon;
    })
    .join('|');
  var url =
    'https://www.google.com/maps/dir/?api=1&origin=' +
    encodeURIComponent(origin) +
    '&destination=' +
    encodeURIComponent(dest) +
    '&travelmode=driving';
  if (wp) url += '&waypoints=' + encodeURIComponent(wp);
  return url;
}

function googleMapsKayakSearchUrl(riverName, stateName) {
  var q = 'kayak canoe launch ' + (riverName || 'river');
  if (stateName) q += ' ' + stateName;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Downloadable KML of launches for Google Earth / Maps import. */
function accessPointsKml(spots, docName) {
  var name = docName || 'Fly Finder launches';
  var placemarks = (spots || [])
    .filter(function (s) {
      return s && s.lat != null && s.lon != null;
    })
    .map(function (s) {
      var title = s.name || s.kind || 'Access';
      return (
        '<Placemark><name>' +
        escapeXml(title) +
        '</name><description>' +
        escapeXml(s.kind || '') +
        '</description><Point><coordinates>' +
        s.lon +
        ',' +
        s.lat +
        ',0</coordinates></Point></Placemark>'
      );
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' +
    escapeXml(name) +
    '</name>' +
    placemarks +
    '</Document></kml>'
  );
}

var api = {
  KAYAK_PADDLE_MPH: KAYAK_PADDLE_MPH,
  haversineMi: haversineMi,
  isLaunchKind: isLaunchKind,
  sortLaunchesDownstream: sortLaunchesDownstream,
  estimateFloatHours: estimateFloatHours,
  formatFloatDuration: formatFloatDuration,
  buildFloatLegs: buildFloatLegs,
  googleMapsPlaceUrl: googleMapsPlaceUrl,
  googleMapsDirUrl: googleMapsDirUrl,
  googleMapsMultiSearchUrl: googleMapsMultiSearchUrl,
  googleMapsKayakSearchUrl: googleMapsKayakSearchUrl,
  accessPointsKml: accessPointsKml
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.FFFloat = api;
}
