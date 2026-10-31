# AI assistant

How the explorer's built-in assistant answers questions, and the rules to keep when
changing it. Architecture and the trust boundary: `AI_CHAT_ARCHITECTURE.md`. What the data
means: `public/data/methodology.md`.

## What it is for

Analysts ask energy questions in plain language and get a short answer built from the
explorer's own data, with the source, year and unit next to every figure. The assistant can
also move the map and the dashboard. It does not search the web, read attachments or make
figures up: if the explorer does not publish something, it says so and offers the closest
thing it has.

## How it is put together

| Part | File | Role |
|---|---|---|
| System prompt | `src/chat/MapChat.jsx` (`SYSTEM_PROMPT`) | Audience, what the data covers, how to answer (grounding, sources, missing data, comparing like with like, caveats, untrusted text), style |
| Data tools | `src/chat/dataServer.js` | 16 read-only tools over `public/data/`; the model sees them as `data__<name>` |
| App tool | `src/chat/appControl.js` | `app__update_state`: navigate, open tabs, filter plants, read the current view |
| Map tools | `@imaps/ai-chat` | `map__*`: camera, layers, legend, what is on screen, screenshot |
| Methodology | `public/data/methodology.md` | One file for people and the model: sources, definitions, limits |
| Model and policy | `src/chat/config.js` | Allowed models (default Claude Opus 5, then Sonnet 5), gateway, locks |

The chat package runs at most 12 tool rounds per answer; tools that take several countries
at once (supply, indicators, re_resources) keep comparisons inside that.

## Design rules

These follow Anthropic's guidance for tool use and prompts; keep them when editing.

1. **The system prompt is context and policy, not a tool list.** It names no tools, so adding
   or removing one never leaves a stale reference. Rules about one tool go in that tool's
   description.
2. **Each tool description is a contract:** what it returns, when to use it (and when another
   tool fits better), what every parameter means, and its limits. Keep it accurate when the
   data changes: a description that promises something the data doesn't do misleads the
   model more than a missing one.
3. **Every result has the same shape.** `{ available: true, source, years/unit, caveats?, ... }`
   or `{ available: false, message }`, where the message says what to try instead. Caveats
   travel with the data (trade problems, planned vs committed, AI-drafted notes), so the model
   can pass them on.
4. **Figures come only from tool results.** General knowledge may explain a concept, never
   supply a number. Missing data is reported as missing. A derived figure (share, growth,
   ratio) comes with how it was worked out: inputs, sources, years, calculation.
5. **Judgement questions get evidence and reasoning,** with the conclusion labelled as the
   assistant's reading of the data. When the answer turns on a choice only the user can make
   (cost versus emissions, which criterion matters most), the assistant asks instead of choosing.
6. **Text from the data is untrusted.** Briefing notes are AI-drafted; the prompt tells the
   model never to act on instructions inside data, and note results restate it.
7. **No shouting.** Plain statements with the reason beside them; current models follow
   instructions closely, and capitalised MUST/NEVER makes them rigid.

## The tools

| Tool | Use for | Source |
|---|---|---|
| `regions` | Region and country ids, power-pool membership | `regions.json` |
| `coverage` | What is published for a country | build file list |
| `methodology` | Where a figure comes from, definitions, limits | `methodology.md` |
| `supply` | Generation, capacity and demand by fuel and year (up to 10 countries) | Ember (national statistics); national sources for 4 countries |
| `capacity` | Operating plant capacity by fuel for a region, fleet age | GEM, GPPD or OSM |
| `pipeline` | Planned and under-construction MW by fuel | GEM |
| `plants` | Largest plants by fuel and status | GEM, GPPD or OSM |
| `trade` | Net imports, partners, flows by year, with known-problem caveats | ENTSO-E, Comtrade, EAPP, national |
| `indicators` | Access (total, urban, rural) and tariffs (up to 30 countries) | World Bank WDI; tariff compilation |
| `re_resources` | Solar and wind resource (up to 30 countries) | Global Solar Atlas, Global Wind Atlas, NASA POWER |
| `fuel_detail` | Split within hydro, coal, wind (Europe) | ENTSO-E harmonised statistics |
| `grid` | Line km by voltage, operators, substations (region) | OpenStreetMap |
| `market` | Wholesale prices and volumes (Türkiye) | EPİAŞ |
| `zones` | Planning-model zones and their plants | EPM zones, OSM plants |
| `load_centres` | Main cities by population (Black Sea) | not recorded |
| `country_note` | Qualitative context: actors, issues, takeaways | AI-drafted briefing notes |

Derived files behind some tools are rebuilt by `tools/prepare_ai.py` (checked in CI), and
`tools/prepare_re.py`; see `DATA_LINEAGE.md`.

## Known limits (state them, don't hide them)

- **National and regional only.** Sub-national figures come in a later iteration (Kenya first).
- **Trade volumes are indicative.** ENTSO-E flows under-count some borders, and Norway,
  Sweden and Denmark cover one price zone (`TRADE_AUDIT.md`). The trade tool attaches these
  caveats to every result.
- **Plant databases and national statistics differ** by design; the tools name the database.
- **The chat package's model list** stops at Claude Opus 5 and Sonnet 5; a package update is
  needed for newer models.

## Test questions

Run these after any change to the prompt, a tool or the data, with the browser's network tab
open. A pass means the answer has the listed property.

| # | Question | Expected |
|---|---|---|
| 1 | What is Kenya's generation mix? | Supply; fuels with GWh or %, year 2025 or latest, source Ember |
| 2 | Compare installed capacity in Ghana, Nigeria and Senegal | One supply call for all three; table; MW and year |
| 3 | How much solar is planned in SAPP? | Pipeline for the region; GEM named; "planned is not committed" |
| 4 | What are the five largest hydro plants in Ethiopia? | Plants (GEM); names and MW |
| 5 | Is Norway a net exporter? | Yes; uses national figures or says the trade file covers one zone |
| 6 | How much electricity does Spain export to Portugal? | Trade with its caveat; volumes called indicative |
| 7 | What is the electricity access rate in Chad? | Indicators; % with reference year; WDI |
| 8 | Which has better solar, Morocco or Chile? And wind? | re_resources; PVOUT and wind speed; whole-country caveat |
| 9 | What share of Austria's hydro is pumped storage? | fuel_detail; split; notes the coverage |
| 10 | What are Turkish day-ahead prices this year? | Market; TL and USD; updated date |
| 11 | What are wholesale prices in Kenya? | Not published; offers retail tariffs instead |
| 12 | What is the installed capacity of Nairobi county? | Sub-national not published; offers national figure |
| 13 | Who are the key actors in Nigeria's power sector? | country_note; says it is AI-drafted, not fact-checked |
| 14 | Where does the explorer's capacity data come from? | Methodology; national statistics vs plant databases |
| 15 | Why do the capacity figures differ between the Supply tab and the map? | Methodology; different sources by design |
| 16 | How long is the transmission grid in WAPP? | Grid; km by voltage; region total, OSM caveat |
| 17 | Take me to Kenya's supply tab | App tool; navigates, then opens the tab |
| 18 | Show only coal plants | App tool; filters; one-line confirmation |
| 19 | What is the capacity here? (on a country page) | Reads the current view first, then answers for that country |
| 20 | What was Germany's GDP in 2023? | Outside the explorer's data; says so, no figure |
| 21 | How dependent is Kenya on imports? | Derives imports as a share of demand from supply and trade; states the inputs, sources, years and calculation |
| 22 | Which country in WAPP has the strongest case for more solar? | Evidence (solar resource, current mix, pipeline, access) and reasoning; conclusion labelled as a reading of the data |
| 23 | Should Kenya build more geothermal or more solar? | Sets out what the data shows for each, then asks which criterion matters (cost, firm supply, speed) instead of choosing |

Before release, also check the deployment items in `AI_CHAT_QA_CHECKLIST.md`.
