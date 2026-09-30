# Lammatna — notes for Claude

- **Publishing:** the owner asked that every finished change be merged into `main` without asking for confirmation. After tests pass, push the working branch, open a PR and merge it. GitHub Pages serves `main` at https://3wasfnjd.github.io/lammatna/.
- After editing `src/`, `shared/`, `styles.css` or dependencies run `npm run build`, then `npm test` (it rejects a stale bundle). `dist/` is committed because Pages serves it as-is.
- Local multiplayer: `npm start` (game + WebSocket rooms on port 8787).
- Character models are configured in `shared/characters.js`; inspect new GLBs with `node tools/inspect-glb.mjs`.
- Replies to the owner are in Arabic.
- Production rooms: Cloudflare Worker `lammatna` (`wrangler.toml`, `server/worker.js`, Durable Object per room code). Clients connect to `/ws?create=1` or `/ws?code=1234`. Local Worker test: `npx wrangler@4 dev`.
