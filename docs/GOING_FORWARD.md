# Going forward

Plan for the Regional Power Explorer after the Design Studio MVP. Written 2026-09-23.
Each section says what is decided, what is next, and what it depends on.

## Principles

These apply to every workstream below.

1. **Everything is hosted on Design Studio.** The app, its data and the EPM Data
   Explorer are served from `designstudio.worldbank.org`. No visitor data goes to a
   third-party service: no outside analytics and no outside form services. The
   approved World Bank basemap and boundary services are the exception.
2. **Static first.** The site is files. A backend is added only where a secret or a
   sign-in requires one, such as an AI gateway, the internal site or form storage.
3. **Build for automation even before it exists.** Automation is paused (see below),
   but every new data source must be ready for it on day one:
   - one script under `tools/` that runs with no questions asked and no manual steps;
   - input from a URL, an API, or a raw file committed under `data-source/raw/`,
     never from somewhere else on someone's machine;
   - output only to `public/data/`, the same result every time it runs on the same input;
   - keys read from environment variables, never written in code;
   - its Python packages added to the (future) pinned requirements file.
4. **Publish without review for now.** What quality assurance looks like is decided
   in the Quality workstream.

## Branches and releases

**Decided:** one long-lived branch, `main` on the ESMAP repo.

Audit of 2026-09-23:

| Branch | Status | Action |
|---|---|---|
| `upstream/main` | Default branch. Only 10 EPİAŞ bot commits since `mvp` branched from it. | **The one branch.** Scheduled jobs write here and Design Studio deploys from here. |
| `mvp` (fork) | 73 commits ahead of `main`, merges into it cleanly. The only branch with work not found elsewhere. | Open a PR into `main`, then delete it. |
| `wb-cartography` (fork and local) | Fully contained in `mvp` | Delete |
| `ai-chat-production-integration` (fork) | Fully contained in `mvp`. `build-design-studio.yml` still triggers on it. | Point the workflow at `main`, then delete |
| `design-studio-deployment` (fork and upstream) | Fully contained in `mvp` | Delete |
| `epias-quantity-series`, `epias-market-pipeline`, `merge-pr1` (upstream) | Already merged into `main` | Delete |
| `master` (upstream) | 274 commits behind `main`; the old default branch | Delete |
| `mike/*` (Mike's fork) | His POC, re-applied by hand in `mvp` | Leave; it is his fork |

Working model from now on (GitHub flow):

- New work starts on a short-lived branch off `main` and returns through a PR.
  The branch is deleted after merging.
- Each Design Studio deployment is **tagged** on `main` (e.g. `v2026.09.0`), so
  it's always known what is live and there is something to roll back to.
- If `main` is protected, the protection must still let `github-actions[bot]`
  push. Otherwise the daily EPİAŞ job stops.

## Workstreams

### 1. EPM Data Explorer on Design Studio (short term)

Source: `ESMAP-World-Bank-Group/epm-data-explorer`. Same stack as this app.
Prepared in ESMAP-World-Bank-Group/epm-data-explorer#2, to be served at
`/epm-data-explorer/`:
- subpath build, hash routes, IIS `web.config`;
- no third-party requests: PostHog removed, forms by email, Chart.js and Open
  Sans self-hosted;
- the World Bank vector basemap, with country geometry from the same GAD extract
  as this app. `tools/prepare_gad.py` is shared, and the two copies should stay
  identical.

Decided:
- **Model data stays live from GitHub.** Pages read inputs and results from the
  `ESMAP-World-Bank-Group/EPM` repo in the visitor's browser (plain GET requests).
  - Watch the anonymous GitHub API limit: 60 calls per hour per IP address, about
    5 per page view, and staff may share outgoing IPs.
  - If run lists come up empty, write the listings into the build.
  - Later, the data comes from DDH (see Quality).
- **Black Sea is left out.** Its data sits in an R2 bucket that Design Studio
  can't reach, and it may be sensitive. The bucket has a public `r2.dev` address
  that is committed in the public repo, so its owner should close or rotate it.

Still to do:
- Deploy it, before or together with this app: the EPM button already points at
  `…/epm-data-explorer/`, which the gateway redirects to its error page until
  EPM Data Explorer is there.
- **Mexico has no infrastructure data.** It is in EPM's `public/data/regions.json`
  but was never added to `data-source/regions.yaml`, which the pipeline reads. So
  no plants, lines, substations or capacity files exist for it.
  - The model map works because its zones and corridors come from the EPM repo.
    Only the infrastructure layers are empty.
  - Fix: add Mexico to `regions.yaml` (as SIEPAC, one country: MEX), run
    `prepare_gppd.py`, `prepare_gem.py` and `prepare_region_data.py` with
    `--regions mexico` (the last needs `worldwide.gpkg`), then `prepare_data.py`.

### 2. Region coverage (short term)

160 of the 245 countries and territories in the boundary file belong to a region.
The largest gaps among World Bank client countries:

- **South America:** ARG, BOL, BRA, CHL, COL, ECU, PER, PRY, URY, VEN
- **Mexico:** MEX, which already has a model in EPM Data Explorer
- **East Asia:** CHN, MNG
- **Eastern Europe:** UKR, MDA, BLR. UKR already has `supply/UKR.json`.
- **Others:** IRN, ERI

What adding a region takes:
1. An entry in both region lists with its member countries:
   `public/data/regions.json` (what the app reads) and `data-source/regions.yaml`
   (what the pipeline reads). Missing the second is how EPM's Mexico ended up
   with no infrastructure data (see workstream 1).
2. Plants, lines and substations per region: `prepare_region_data.py`,
   `prepare_gppd.py`, `prepare_gem.py`, then `prepare_data.py`. **This needs
   `worldwide.gpkg`, which lives outside the repo, and nobody has written down how
   it was made. Recording that is the first task here.**
3. Country supply data from the OWID and Ember pipelines, which work for any country.
4. The first-level subdivision layer (`prepare_admin1.py`) and optionally a
   briefing note.

Open question: which grouping to use for South America (one region, or the Andean
and Southern Cone interconnections separately).

### 3. Data additions (short to medium term)

Priority: **market structure** per country, for example unbundling, who owns
generation and the grid, the regulator, the wholesale market model, whether IPPs
are allowed, and the tariff setting.

- Fits the existing country JSON pattern (`public/data/<topic>/<ISO3>.json`) and a
  new country tab.
- Sources to evaluate: the World Bank RISE indicators (regulatory), national
  regulators' websites, and the Bank's own power sector reform studies. **Not
  checked yet;** licence and coverage must be confirmed before use.
- `docs/candidate-sources.md` lists other open sources already found
  (demand, renewable profiles, hydro).
- Each addition follows principle 3.

### 4. Structure improvements (medium term, as needed)

In rough order of payoff:

1. **Data separate from the build.** The list of data files is fixed at build time
   (`src/utils/dataGuard.js`), so every data change needs a rebuild. Write a
   `manifest.json` each time data is published and load it when the app starts.
   Then data can be updated without changing the app.
2. **Reproducible pipeline environment.** Add a pinned `tools/requirements.txt`;
   today the scripts assume a local conda env called `gams_env`.
3. **One region definition shared by both apps.** This app and EPM Data Explorer
   each keep their own `regions.json`.
4. **PMTiles for the heavy layers** (lines, plants, country outlines), as planned in
   `docs/AI_CHAT_ARCHITECTURE.md`. Needed before the multi-sector work.
5. **Housekeeping:** split the main JavaScript bundle (the build warns about its
   size), and fix the lint errors already present in `CountryPage.jsx`.

### 5. Digital, transport and water (medium to long term)

Adds non-power sectors to the same map and pages.

- Needs workstream 4 first, especially PMTiles. Road, rail and fibre networks are
  far larger than the power grid.
- The app's structure has to stop assuming power: a list of sectors and layers
  instead of power-specific pages, and naming that isn't "power".
- Candidate sources, **none checked yet:** OpenStreetMap (roads, rail, ports),
  ITU for broadband and connectivity, WRI Aqueduct and HydroSHEDS for water.
- Decide early whether this stays one product or becomes a family of explorers
  that share code.

### 6. Quality data (long term)

- **DDH as the source of truth.** DDH will have API access with internal and
  external labels. The build step pulls from DDH, replacing GitHub and the national
  files where DDH has them.
- **Public and internal sites.** The public site builds only from external-labelled
  data. A separate internal site, behind Bank sign-in, also uses internal data. The
  DDH credentials stay on the build machine or a server-side proxy, never in the browser.
- **QA process:** decide who signs off what before it is published. Today it
  publishes with no review. Automatic checks come first: files parse, country codes
  are known, totals don't drop suddenly, sizes stay within limits.
- **Show where each figure came from:** source and date next to every figure, building
  on the quality indicators already on the Data Sources page.

## Automation (paused)

Paused on 2026-09-23. What it will cover, and what has to be true first:

| Piece | State | Needs |
|---|---|---|
| Deploy on merge to `main` | Manual: build, copy to the share, release 1268 | Design Studio admin: what release 1268 takes as input and whether it can deploy automatically |
| EPİAŞ daily update | **Running** on upstream `main` | Nothing, once `main` is the deployed branch |
| OWID, Ember, GEO, WB boundaries | Download their own inputs; never run unattended | Pinned requirements file, one test run |
| ENTSO-E, Comtrade | Can be automated | API keys as repo secrets |
| TUR, AZE, UZB, ARM | Read files a person supplies | A person adds the file and CI rebuilds from it |
| Lines, plants, substations | Can't be automated yet | Where `worldwide.gpkg` comes from; a heavy-job runner |
| GPPD | No longer updated at the source | Nothing to schedule |

Where it runs: GitHub Actions on the ESMAP repo is proven (EPİAŞ). Azure DevOps and
the requested Azure resource group are the alternative. Whether Bank build machines
can reach the outside APIs is not confirmed.

## Azure resource group (requested)

When it arrives, it's used for the following. No database until the internal site
needs queries that DDH's API can't answer.

| Service | Use |
|---|---|
| Blob Storage | Published data and its manifest (workstream 4.1), `worldwide.gpkg` |
| Azure DevOps scheduled pipelines | Heavy data jobs (geospatial) |
| Function App, timer | Light scheduled jobs: EPİAŞ, EPM model data, later DDH |
| Function App, HTTP | AI gateway holding the provider keys; form submissions into Table Storage; a proxy for the internal site that holds the DDH credentials |
| Application Insights | Usage analytics hosted by the Bank, replacing PostHog |

Check first: whether a page on Design Studio may load data from Bank Azure storage
(gateway and cross-origin rules).

## Open questions

- Design Studio admin: what release 1268 takes as input; whether the site may load
  from Bank Azure storage.
- How `worldwide.gpkg` is made.
- Agreement from the ESMAP repo team on the branch model and on deleting old branches.
- The region grouping for South America.
- The owner of the R2 bucket that holds the Black Sea data.
