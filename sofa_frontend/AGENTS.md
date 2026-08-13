# AI Agent Instructions

This repository is a small React + Vite frontend app.

## Key project facts
- Frontend only: no backend code in this repo.
- Entry point: `src/main.jsx`
- Main app component: `src/App.jsx`
- Styling: `src/index.css` and `src/App.css`
- Assets: `src/assets`
- Uses React 19 and Vite 8 with ESM imports
- Build tooling: `npm install`, `npm run dev`, `npm run build`, `npm run lint`
- Linting uses `oxlint` and `.oxlintrc.json`
- `package.json` is `private: true`

## Agent guidance
- Prefer minimal React + Vite conventions rather than introducing unrelated frameworks.
- Do not convert the repo to TypeScript unless the user explicitly requests it.
- Keep the app structure in `src/` and avoid adding server-side files.
- When modifying dependencies, update both `package.json` and `package-lock.json`.
- Use `npm run lint` to validate formatting and lint issues for changes.

## References
- `README.md` for the current template description and recommended Oxlint/React guidance.
