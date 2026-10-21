# Suave

Natural-language 3D asset search that picks the right view for what you asked, then suggests what goes with your cart.

Three layers, each swappable and testable on its own:

| Layer | What | Where |
| --- | --- | --- |
| Retrieval | EmbeddingGemma 2 embeds each asset's text and thumbnail into one space, so a query can match what an asset looks like, not only its name. BM25 keyword search runs alongside as the metadata-only baseline. | `embed/` |
| Intent | Jev (TypeSafe) answers typed questions (which view, how many, what kind of thing, is it describing appearance) with calibrated confidence. Below 0.6 the UI asks instead of guessing. Keyword rules stand in when there is no key. | `server/` |
| Views | Results, grouped sets, Compare and Scale check (thumbnails drawn to real height next to a 1.8 m person), Look-alikes. | `src/components/` |

## Data

- **Assets:** 521 CC0 models from [Poly Haven](https://polyhaven.com/models).
- **Metadata:** author and created date are real Poly Haven values. Poly Haven has no edit history, so `lastModifiedAt` is a stable sample date and the UI labels it as one. `npm run embed:enrich` rebuilds it.
- **Collections:** `server/library.ts` can write collections to a local metadata API at `LIBRARY_URL` (default `http://127.0.0.1:8888`). Without one, collections stay in the browser.

## Run

```bash
npm install
npm run embed:setup          # Python venv with sentence-transformers
npm run embed:index          # ~20 min on an Apple M3: thumbnails + three embedding spaces

npm run embed:serve          # retrieval server on 127.0.0.1:8765
npm run dev                  # Vite on 127.0.0.1:5187
```

`npm test` reads the generated index, so run `npm run embed:index` first.

Everything runs without API keys. To route queries through Jev or title threads with Gemini, copy `.env.example` to `.env.local` and set `TYPESAFE_API_KEY` and `GEMINI_API_KEY`. `.env.local` is gitignored.

## Static deploy

`npm run build:public` builds a static app where retrieval runs in the browser: a Web Worker loads the index and encodes queries with EmbeddingGemma 2 through Transformers.js. `functions/api/[[path]].ts` serves `server/api.ts` as a Cloudflare Pages Function. Set keys as Pages secrets (`npx wrangler@4 pages secret put TYPESAFE_API_KEY`), never in `wrangler.toml`. `JEV_HOURLY_BUDGET` caps paid calls per instance.

## License

Code is MIT (see `LICENSE`). Third-party data and models keep their own terms (see `NOTICE`).
