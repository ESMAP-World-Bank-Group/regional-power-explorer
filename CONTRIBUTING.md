# Contributing to the Regional Power Explorer

Thanks for your interest in improving the Regional Power Explorer. Contributions are
welcome — whether code, bug reports, or suggestions for new data sources.

## Ways to contribute

- **Suggest a data source or report a coverage gap** — open a
  [GitHub Issue](https://github.com/ESMAP-World-Bank-Group/regional-power-explorer/issues)
  describing the source, what it covers, its licence, and a link.
- **Report a bug** — open an Issue with steps to reproduce, expected vs actual behaviour,
  and your browser/OS.
- **Contribute code** — see the workflow below.

## Development workflow

1. Fork the repository (or create a branch if you are a maintainer).
2. Install and run locally:
   ```bash
   npm install
   npm run dev
   ```
3. Make your change in a focused branch named for the work (e.g. `fix/country-tooltip`,
   `feat/add-tariff-layer`).
4. Keep the code style consistent with the surrounding files and ensure linting passes:
   ```bash
   npm run lint
   npm run build      # make sure the production build succeeds
   ```
5. Open a Pull Request against `main` with a clear description of *what* and *why*.

## Updating data

Curated, web-ready data lives in `public/data/` (committed). Raw inputs and pipeline
intermediates live in `data-source/` and are **git-ignored** — they are produced/refreshed
by the scripts in `tools/`. When updating data:

- Do not commit raw bulk data or API caches; only the curated output under `public/data/`.
- Keep the **Data Sources** page (`src/pages/AboutPage.jsx`) in sync: every layer should
  have an accurate source, version, update date, coverage, and quality indicator.
- Never commit API tokens or credentials (`config/api_tokens.ini` is git-ignored).
  Copy `config/api_tokens.ini.example` to `config/api_tokens.ini` and fill in your
  own values — the example file documents which key each pipeline expects.

## Code style

- React 19 + Vite, function components and hooks.
- Match the existing structure (`src/pages`, `src/components`, `src/utils`).
- ESLint is configured (`eslint.config.js`); please run `npm run lint` before pushing.

## Licensing of contributions

By contributing, you agree that your contributions will be licensed under the project's
[MIT License](LICENSE). Make sure any data source you add is open-licensed and that its
licence is documented on the Data Sources page.

## Code of conduct

Please be respectful and constructive. This project follows the World Bank Group's open
source community expectations; harassment or abusive behaviour is not tolerated.
