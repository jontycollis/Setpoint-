# MyTeam.Click API probe — captured 2026-06-05

Captured via the Bior Claude-in-Chrome probe session against a real
logged-in account (player `abby collis`, id `6699665202d4e2634939d1e7`).
The SPA at https://myteam.click is Angular 20.3.10 (Capacitor-wrapped on
mobile) and proxies all API calls to a Heroku backend.

## Base + auth

- **Base URL**: `https://myteamclick.herokuapp.com`
- **Auth header**: `token: <jwt>` — NOT `Authorization: Bearer`. JWT is
  stored at `localStorage.CapacitorStorage.user.token`. Long-lived
  (sample token issued 2025-08-07 with exp 2053-01-12).
- **Required headers every request**:
  - `token: <jwt>`
  - `Accept: application/json`
  - `clientvs: 5.6.48` (matches `MyTeam.Click X.Y.Z` in the menu)
  - `platform: web` (also seen: `ios`, `android`)
  - `source: <action-name>` (per-endpoint sentinel; e.g.
    `findTournamentsInRange`, `getTournamentView`, `getSchedule`,
    `getMyEventsSinceV5`, `getUserSearchArea`)
- **CORS gotcha**: probing from a third-party origin will fail preflight
  if Authorization header is set — only the `token` header is allowed.
- Capacitor user blob (`localStorage.CapacitorStorage.user`):
  `{"token":"…","_id":"…","firstName":"abby","lastName":"collis"}`

## Endpoints (verified)

### Discovery — search by geographic area
```
POST /volley/tournament/search/advanced
source: findTournamentsInRange
body: {
  searchArea: {
    radius: number,        // km
    loc: string,           // human-readable, e.g. "Toronto, ON, Canada"
    long: number,          // signed longitude
    lat: number,           // signed latitude
    changed?: boolean      // optional
  },
  afterDate: string        // ISO timestamp; events with date >= afterDate
}
```
Response:
```
{
  success: boolean,
  serverDate: number,                       // ms epoch
  orgList: [{_id, name, abbr, timeZone}],   // dictionary of orgs
  locList: [{_id, name, timeZone, city, stateProv}],
  eventList: [
    {
      loc: { distance: number, _id: string },   // m? km? (5534 = Toronto→Bay; likely 5.5km ⇒ km*1000? unclear)
      event: {
        _id: string,
        orgId: string,                          // → orgList[_id]
        name: string,
        date: ISO,
        timeFrames: [{start: ISO, end: ISO}],
        states: { canceled: boolean },
        displaySettings: {},
        regStartDates: [{date: ISO, code: string}],
        groups: [{
          name: string,                         // e.g. "2x2 Women Open", "Top Guns - Men's 2s Open"
          maxTeams: number,
          wlActive: boolean,                    // waitlist active
          stateCount: { act: number, wl: number }  // teams registered / waitlist
        }],
        locList: [{_id: string}]                // → top-level locList
      }
    }
  ]
}
```
NB: `afterDate` is REQUIRED. `beforeDate` returns 0 results — past
event discovery requires a different path (likely `/league/eventlist`).

### Player's own events
```
GET /volley/v5/player/eventlist/since/<msTimestamp>
source: getMyEventsSinceV5
```
Response:
```
{
  success: boolean,
  eventList: [{
    _id, name, date, endDate, timeZone,
    timeFrames, states: {schedulePublished, hideUntilStart, canceled},
    orgRef: {org: orgId},
    locList: [{_id}],
    teamRefList: [{_id, name, state}],          // teams the user belongs to
    sched: boolean,                             // true when schedule is published
    leagueId, isAdmin, hasActiveTeam
  }],
  leagueList: [...],
  locList: [...],
  orgList: [...]
}
```

### Per-event schedule (the gold endpoint for indexing)
```
GET /volley/schedule/<eventId>
source: getSchedule
```
Response:
```
{
  success: boolean,
  org: {_id, name, ...},
  customConfig, timeouts, timeZone, adminLevel, leagueInfo,
  event: {
    _id, name, date, timeFrames,
    leagueRef: {name, league: leagueId},
    orgRef: {name, org: orgId, abbr},
    locList: [{_id, name}],
    courtDef: [],
    groups: [{
      _id, name, suffix,
      teams: [{
        _id,
        name: string,                           // e.g. "A.Collis/K.McKeil" (beach pair format)
        state: number,                          // 2 = active/complete
        slots: [{firstName, lastName, _id}],    // players in the pair/team
        admins: [{firstName, lastName, _id}],
        startRank,
        no,                                     // entry sequence number
        groupPos,                               // FINAL POSITION within group (= final rank)
        poolPos,                                // position in pool play
        mWon, mLost,                            // match record
        sWon, sLost,                            // set record
        pf, pa                                  // points for / against
      }],
      poolRounds,
      poolPlay: {
        useMatchesWon: boolean,
        poolList: [{
          no, configId, state,
          teamIdList: [teamId, ...],
          matchRefList: [matchSeqNo, ...],      // → matchList[_id]
          useMatchesWon
        }]
      },
      challenge: { matchRefList: [] },
      finals: {
        initMethod: 'MINI_X' | ...,
        orderBy: 'groupPos' | ...,
        applyCP: boolean,
        state: number,
        treeList: [],
        matchRefList?: []
      }
    }],
    matchList: [{
      _id: number,                              // sequence number 1..N
      type: 'P' | 'F' | ...,                    // P = pool, F = finals/bracket
      state: number,                            // 2 = complete
      teams: [{
        teamId: string,
        scores: [number, ...]                   // per-set score, length 1..3
      }],
      arbitId?: string,                         // referee teamId
      idSig?: string
    }],
    persistentTeams, reqPlayerConsentList,
    config, displaySettings, _version,
    teamHistory, customConfig
  }
}
```

### Saved player search area (for area-default lookups)
```
GET /volley/player/searcharea
source: getUserSearchArea
```
Response: `{success, zipCode}` (very thin).

### Endpoints inventoried from bundle (not yet probed)

Found in `chunk-*.js` (Angular routes that build URLs via template
literals — surface scraped via regex):

- `GET /volley/event/tournament/view/<eventId>` (alternate, lighter
  than `/schedule/<eventId>` — captured earlier with source
  `getTournamentView`)
- `GET /volley/groupholder/teamlist/view/<eventId>/<groupId>`
  (returned `500 SERVER_ERROR` on a future event — probably needs the
  event to have published lineups)
- `GET /volley/league/eventlist/<leagueId>`
- `GET /volley/league/tournamentlist/<leagueId>`

## Beach team naming convention

Beach pairs are stored as `name: "A.Collis/K.McKeil"` — slash-separated
last names with first-initial dot prefix. The `slots[]` array carries
the canonical first/last name pair (length 2 for 2x2, more for 4s/6s).

Bior's existing `extractClubKey` (clubDetection.ts) already treats
slash-separated names as beach pairs (returns null club). No change
needed there.

## Time zones + venue

- Every org and loc carries `timeZone` (IANA, e.g. `America/Toronto`).
- Events surface times as ISO strings. Use the org/loc `timeZone` for
  display.

## Probe replay recipe

To re-probe against a fresh account / new endpoint:

1. Log in to https://myteam.click in a real browser
2. Open DevTools → Console
3. Install the XHR hook (see `myteamClickProbe.js` snippet — pasted
   below for reference):
   ```js
   window.__captures = [];
   const X = XMLHttpRequest.prototype;
   const origOpen = X.open, origSend = X.send, origSetHeader = X.setRequestHeader;
   X.open = function(m,u){this.__u=u;this.__m=m;this.__h={};return origOpen.apply(this,arguments)};
   X.setRequestHeader = function(k,v){this.__h[k]=v;return origSetHeader.apply(this,arguments)};
   X.send = function(b){
     this.addEventListener('loadend', () => {
       if (this.__u && this.__u.includes('heroku'))
         window.__captures.push({url:this.__u, method:this.__m, body:b?String(b):null, headers:this.__h, status:this.status, resp:(this.responseText||'').slice(0,4000)});
     });
     return origSend.apply(this, arguments);
   };
   ```
4. Click around the SPA to trigger the calls you care about.
5. `console.table(window.__captures.map(c => ({url:c.url, source:c.headers.source, status:c.status})))`
6. To replay a specific call, copy the source/body and replay via
   `fetch()` with the same headers.

## Known limitations

- Geocoding the search location is server-side (`/volley/player/address/geocode`).
  The SPA stores the geocoded result in `localStorage.CapacitorStorage.searchArea`.
- The Heroku API tolerates the `changed` boolean in `searchArea` but
  doesn't seem to use it for filtering. Safe to set false.
- `loc.distance` units are unclear (sample value 5534 for ~5km).
  Probably meters; verify before exposing it to a UI.
